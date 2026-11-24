// The pipeline registry (v2/engine/pipelines.js) on a fake device: everything builds async before the first frame; a
// declaration, build or unknown get after seal() is a loud, counted error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineRegistry } from '../engine/pipelines.js';

const fakeDevice = ({ failOn = null } = {}) => {
  const calls = { async: 0, sync: 0 };
  return {
    calls,
    createShaderModule: ({ label, code }) => ({ label, code, getCompilationInfo: async () => ({ messages: label === 'bad' ? [{ type: 'error', lineNum: 2, linePos: 3, message: 'unknown identifier' }] : [] }) }),
    createRenderPipeline: () => { calls.sync++; throw new Error('sync build: not allowed'); },
    createRenderPipelineAsync: async (d) => { calls.async++; if (d.label === failOn) throw new Error(`compile failed: ${d.label}`); return { label: d.label }; },
    createComputePipelineAsync: async (d) => { calls.async++; return { label: d.label }; },
    pushErrorScope() {}, popErrorScope: async () => null,
  };
};

test('declare, build all async, get', async () => {
  const errors = [], dev = fakeDevice();
  const reg = createPipelineRegistry(dev, { errors });
  reg.add('sky', { vertex: {} }); reg.add('plane', { vertex: {} });
  assert.throws(() => reg.get('sky'), /not built/);
  assert.equal(await reg.buildAll(), 2);
  assert.equal(reg.get('sky').label, 'sky'); assert.equal(dev.calls.async, 2); assert.equal(dev.calls.sync, 0);
  assert.ok(reg.buildMs >= 0);
  assert.deepEqual(reg.names(), ['sky', 'plane']);
  assert.equal(errors.length, 1, 'the early get was recorded');
});

test('after seal(): a new add, a buildAll or an unknown get is an error and counted in late', async () => {
  const errors = [];
  const reg = createPipelineRegistry(fakeDevice(), { errors });
  reg.add('sky', {});
  await reg.buildAll(); reg.seal();
  assert.throws(() => reg.add('late', {}), /after the first frame/);
  await assert.rejects(() => reg.buildAll(), /after the first frame/);
  assert.throws(() => reg.get('ghost'), /never declared/);
  assert.equal(reg.late, 3);
  assert.equal(errors.length, 3);
  assert.equal(reg.get('sky').label, 'sky', 'built ones still serve');
});

test('a failed build names the pipeline and the compiler message with its line', async () => {
  const errors = [], dev = fakeDevice({ failOn: 'plane' });
  const reg = createPipelineRegistry(dev, { errors });
  reg.shader('bad', 'line one\n  let x = nope;\n');
  reg.add('sky', {}); reg.add('plane', {});
  await assert.rejects(() => reg.buildAll(), /pipeline "plane" failed: compile failed: plane[\s\S]*bad:2:3 unknown identifier[\s\S]*let x = nope;/);
  assert.equal(errors.length, 1);
});

test('a name declared twice is refused', () => {
  const reg = createPipelineRegistry(fakeDevice());
  reg.add('sky', {});
  assert.throws(() => reg.add('sky', {}), /twice/);
});

// BACKLOG-v2 #31: MSAA live. A scene pipeline (its multisample count is the start count, or a function of the count) is
// declared at every count; buildAll() builds the start count; buildCount(n) builds another set async after seal(); use(n)
// moves get() there only once that set is whole; a get of an unbuilt set still throws and counts as late.
test('#31: the start count at load, the other count async after the first frame, then use()', async () => {
  const errors = [], dev = fakeDevice();
  const made = [];
  const reg = createPipelineRegistry(dev, { errors, msaa: 1, counts: [1, 4] });
  reg.add('sky', { vertex: {}, multisample: { count: 1 } });
  reg.add('trees', (n) => { made.push(n); return { vertex: { n }, multisample: { count: n, alphaToCoverageEnabled: n > 1 } }; });
  reg.add('sim', { compute: {} });
  assert.deepEqual(made, [1, 4], 'a function is called for each count at add(): every module made at load');
  assert.equal(reg.perCount, 2);
  await reg.buildAll(); reg.seal();
  assert.equal(dev.calls.async, 3, 'the load built the start count only (2 scene + 1 compute)');
  assert.equal(reg.ready(1), true); assert.equal(reg.ready(4), false);
  assert.equal(reg.get('sky').label, 'sky');
  assert.throws(() => reg.use(4), /not built/, 'a switch before the set is built is refused');
  const p = reg.buildCount(4);
  assert.equal(reg.buildCount(4), p, 'a second call shares the build');
  const r = await p;
  assert.equal(r.n, 2); assert.equal(dev.calls.async, 5); assert.equal(dev.calls.sync, 0);
  assert.equal(reg.ready(4), true);
  reg.use(4);
  assert.equal(reg.sampleCount, 4);
  assert.equal(reg.get('sky').label, 'sky@4x'); assert.equal(reg.get('trees').label, 'trees@4x');
  assert.equal(reg.get('sim').label, 'sim', 'compute pipelines are shared');
  reg.use(1); assert.equal(reg.get('sky').label, 'sky');
  assert.equal(reg.built, 5);
  assert.equal(reg.background()[4].n, 2);
});

test('#31: a get at a count whose set is not built throws and counts as late (no build in play)', async () => {
  const errors = [], dev = fakeDevice();
  const reg = createPipelineRegistry(dev, { errors, msaa: 4, counts: [1, 4] });
  reg.add('sky', { multisample: { count: 4 } });
  await reg.buildAll(); reg.seal();
  // force the active count without the guard (as a bug would): the frame's get must fail, never build
  assert.throws(() => reg.use(1), /not built/);
  assert.equal(reg.sampleCount, 4, 'the refused switch left the active count');
  assert.equal(dev.calls.async, 1); assert.equal(dev.calls.sync, 0);
  assert.equal(reg.late, 1);
});

test('#31: the derived descriptor moves the sample count (and alpha to coverage with it)', async () => {
  const seen = [];
  const dev = { ...fakeDevice(), createRenderPipelineAsync: async (d) => { seen.push(d); return { label: d.label }; } };
  const reg = createPipelineRegistry(dev, { msaa: 4, counts: [1, 4] });
  reg.add('cards', { vertex: {}, multisample: { count: 4, alphaToCoverageEnabled: true } });
  reg.add('swap', { vertex: {} });   // no multisample state: not a scene pipeline, one build
  await reg.buildAll(); reg.seal();
  await reg.buildCount(1);
  const one = seen.find((d) => d.label === 'cards@1x');
  assert.deepEqual(one.multisample, { count: 1, alphaToCoverageEnabled: false });
  assert.equal(seen.filter((d) => d.label.startsWith('swap')).length, 1);
});

test('#31: without counts the registry is as before; an undeclared count is refused', async () => {
  const reg = createPipelineRegistry(fakeDevice(), { msaa: 4, counts: [4] });
  reg.add('sky', { multisample: { count: 4 } });
  await reg.buildAll(); reg.seal();
  await assert.rejects(() => reg.buildCount(1), /not declared/);
  assert.equal(reg.ready(1), false);
  const plain = createPipelineRegistry(fakeDevice());
  plain.add('sky', { multisample: { count: 4 } });
  plain.add('fn', (n) => ({ multisample: { count: n } }));
  assert.equal(await plain.buildAll(), 2);
  assert.equal(plain.perCount, 0);
});

test('#31: a failed background build is loud and leaves the active set serving', async () => {
  const errors = [];
  const dev = fakeDevice({ failOn: 'sky@4x' });
  const reg = createPipelineRegistry(dev, { errors, msaa: 1, counts: [1, 4] });
  reg.add('sky', { multisample: { count: 1 } });
  await reg.buildAll(); reg.seal();
  await assert.rejects(() => reg.buildCount(4), /pipeline "sky" failed/);
  assert.equal(errors.length, 1); assert.equal(reg.ready(4), false);
  assert.equal(reg.get('sky').label, 'sky');
  assert.ok(reg.background()[4].error);
});

test('ultra M2: fixedSamples keeps an own-target pipeline at its own count when the scene moves (the caustics\' 4× splat)', async () => {
  let made = null;
  const dev = { ...fakeDevice(), createRenderPipelineAsync: async (d) => { made = d; return { label: d.label, count: d.multisample?.count }; } };
  const reg = createPipelineRegistry(dev, { msaa: 4, counts: [1, 4] });
  reg.add('splat', { vertex: {}, multisample: { count: 4 }, fixedSamples: true });
  assert.equal(reg.perCount, 0, 'not a scene pipeline');
  await reg.buildAll(); await reg.buildCount(1); reg.use(1);
  assert.equal(reg.get('splat').count, 4, 'still 4× after the scene moved to 1×');
  assert.equal('fixedSamples' in made, false, 'the flag never reaches WebGPU');
});

// perf(v2) iOS pipelines: groups, the deferred build after the first frame, paced one at a time, and the release queue
import { createReleaseQueue, costs } from '../engine/pipelines.js';
const slowDevice = () => {
  let inFlight = 0, most = 0;
  const dev = fakeDevice();
  const slow = async (d) => { inFlight++; most = Math.max(most, inFlight); await new Promise((r) => setTimeout(r, 2)); inFlight--; dev.calls.async++; return { label: d.label }; };
  return { ...dev, createRenderPipelineAsync: slow, createComputePipelineAsync: slow, get most() { return most; } };
};

test('iOS pipelines: with defer, buildAll() builds core and the groups released before it; the rest after seal(), one at a time', async () => {
  const errors = [], dev = slowDevice();
  const reg = createPipelineRegistry(dev, { errors, defer: true, msaa: 4, counts: [1, 4] });
  reg.add('sky', { multisample: { count: 4 } });
  let prev = reg.group('forest');
  reg.add('trees', { multisample: { count: 4 } }); reg.add('cull', { compute: {} }); reg.add('bake', { compute: {} });
  reg.group(prev);
  prev = reg.group('night'); reg.add('stars', { multisample: { count: 4 } }); reg.group(prev);
  assert.equal(prev, 'core');
  reg.release('night');   // an evening page: with the load
  await reg.buildAll(); reg.seal();
  assert.equal(reg.built, 2, 'core + night at load');
  assert.equal(reg.ready('core'), true); assert.equal(reg.ready('night'), true); assert.equal(reg.ready('forest'), false);
  assert.throws(() => reg.get('trees'), /not built/, 'an ungated draw stays loud');
  const r = await reg.release('forest');
  assert.equal(r.n, 3); assert.equal(reg.ready('forest'), true); assert.equal(reg.get('trees').label, 'trees');
  assert.equal(dev.most, 2, 'after seal: never more than one compile in flight (the load ran two at once)');
  assert.equal(reg.late, 1, 'only the early get counted');
  assert.equal(reg.groups().forest.ready, true); assert.equal(reg.groups().forest.n, 3);
  assert.equal(errors.length, 1);
});

test('iOS pipelines: a group released after a count switch is built at every count wanted; use() waits for released groups only', async () => {
  const reg = createPipelineRegistry(fakeDevice(), { defer: true, msaa: 4, counts: [1, 4] });
  reg.add('sky', { multisample: { count: 4 } });
  const prev = reg.group('forest'); reg.add('trees', { multisample: { count: 4 } }); reg.group(prev);
  await reg.buildAll(); reg.seal();
  await reg.buildCount(1);
  assert.equal(reg.ready(1), true, 'the 1x set is whole without the unreleased forest');
  reg.use(1);
  await reg.release('forest');
  assert.equal(reg.get('trees').label, 'trees@1x');
  reg.use(4);
  assert.equal(reg.get('trees').label, 'trees', 'built at the count already built too');
});

test('iOS pipelines: without defer every group builds with the load (captures, the goldens)', async () => {
  const reg = createPipelineRegistry(fakeDevice(), { defer: false });
  reg.add('sky', {}); const prev = reg.group('storm'); reg.add('rain', {}); reg.group(prev);
  await reg.buildAll(); reg.seal();
  assert.equal(reg.built, 2); assert.equal(reg.ready('storm'), true);
  assert.deepEqual(await reg.release('storm'), { group: 'storm', n: 0, ms: 0 });
});

test('iOS pipelines: costs() charges each pipeline the time after the later of its issue and the previous resolve', () => {
  const c = Object.fromEntries(costs([['a', 0, 100], ['b', 0, 250], ['c', 300, 320]]));
  assert.deepEqual(c, { a: 100, b: 150, c: 20 });
});

test('iOS pipelines: timings() sums the load by family, slowest first', async () => {
  const reg = createPipelineRegistry(slowDevice());
  reg.add('water', {}); reg.add('water-fft', { compute: {} }); reg.add('sky', {});
  await reg.buildAll();
  const t = reg.timings();
  assert.equal(t.n, 3);
  assert.deepEqual(t.families.map(([f, , n]) => [f, n]).sort(), [['sky', 1], ['water', 2]]);
  assert.ok(t.total >= 0 && t.top.length === 3);
});

test('iOS pipelines: the release queue builds groups in order, one at a time; now() jumps the queue; ready() never starts one', async () => {
  const order = [];
  const reg = createPipelineRegistry(fakeDevice(), { defer: true });
  for (const g of ['a', 'b', 'c']) { const p = reg.group(g); reg.add(`${g}-1`, {}); reg.group(p); }
  await reg.buildAll(); reg.seal();
  const q = createReleaseQueue({ ready: (g) => reg.ready(g), release: (g) => { order.push(g); return reg.release(g); } }, ['a', 'b', 'c']);
  const cReady = q.ready('c');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(order, [], 'nothing before start()');
  q.start(); q.now('c');
  await cReady; await q.ready('b');
  assert.deepEqual(order, ['a', 'c', 'b'], 'a was building; c jumped ahead of b');
  assert.equal(q.has('b'), true); assert.deepEqual(q.pending, []);
});

test('iOS pipelines: a group released after buildAll() took its list but before seal() is built, not just marked', async () => {
  const reg = createPipelineRegistry(fakeDevice(), { defer: true });
  reg.add('sky', {}); const prev = reg.group('towns'); reg.add('piers', {}); reg.group(prev);
  await reg.buildAll();
  const r = await reg.release('towns');
  assert.equal(r.n, 1); assert.equal(reg.ready('towns'), true); assert.equal(reg.get('piers').label, 'piers');
});

//, 2026-11-17: Regatta's props and lines "imported only when Regatta starts"): a late group
test('a late group: after seal() a deferred registry takes add() into an unreleased group and builds it on release; core, a released group or a plain registry still refuse', async () => {
  const errors = [], dev = slowDevice();
  const reg = createPipelineRegistry(dev, { errors, defer: true, msaa: 4, counts: [1, 4] });
  reg.add('sky', { multisample: { count: 4 } });
  let prev = reg.group('night'); reg.add('stars', { multisample: { count: 4 } }); reg.group(prev);
  await reg.buildAll(); reg.seal();
  await reg.release('night');
  prev = reg.group('raceKit');
  reg.add('race-lines', { multisample: { count: 4 } }); reg.add('race-props', { multisample: { count: 4 } });
  reg.group(prev);
  assert.equal(reg.ready('raceKit'), false, 'declared, not built');
  const r = await reg.release('raceKit');
  assert.equal(r.n, 2); assert.equal(reg.ready('raceKit'), true); assert.equal(reg.get('race-props').label, 'race-props');
  assert.equal(reg.late, 0); assert.equal(errors.length, 0);
  assert.throws(() => reg.add('late-core', {}), /after the first frame/, 'core: refused');
  prev = reg.group('night'); assert.throws(() => reg.add('late-night', {}), /after the first frame/, 'a released group: refused'); reg.group(prev);
  const plain = createPipelineRegistry(fakeDevice(), { errors: [] });
  await plain.buildAll(); plain.seal();
  plain.group('raceKit'); assert.throws(() => plain.add('x', {}), /after the first frame/, 'a capture\'s registry (no defer): refused');
  assert.equal(reg.late, 2);
});

test('perf(v2) phone build: delayMs (?pipedelay=) waits before each build, one at a time (an emulated slow compiler)', async () => {
  const reg = createPipelineRegistry(fakeDevice(), { delayMs: 20 });
  for (const n of ['a', 'b', 'c', 'd']) reg.add(n, { vertex: {} });
  const t0 = performance.now();
  assert.equal(await reg.buildAll(), 4);
  assert.ok(performance.now() - t0 >= 4 * 20 - 5, 'four builds, one delay each, in a row (not side by side)');
  const fast = createPipelineRegistry(fakeDevice());
  for (const n of ['a', 'b', 'c', 'd']) fast.add(n, { vertex: {} });
  const t1 = performance.now(); await fast.buildAll();
  assert.ok(performance.now() - t1 < 40, 'no delay by default');
});
