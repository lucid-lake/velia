// The system registry (src/core/systems.js) and the frame's order (refactor Phase 2 step 3): the phases run in order,
// dispose runs once each, the env is written by its owner before its readers, and the whole frame (src/core/loop.js
// createFrame + src/core/world.js worldSystems) calls the modules in exactly the order the old drawOnce did
// (tests/fixtures/frame-order.json, recorded in the browser before the change).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSystems, createEnv, PHASES } from '../classic/src/core/systems.js';
import { createFrame } from '../classic/src/core/loop.js';
import { worldSystems } from '../classic/src/core/world.js';
import { stormSystem, createStorm, naturalPlan } from '../classic/src/weather/storm.js';
import { WindField } from '../src/sim/wind.js';

const BASELINE = JSON.parse(readFileSync(new URL('./fixtures/frame-order.json', import.meta.url), 'utf8'));

test('phases: pre, sim, scene, audio, post, whatever the registration order; order within a phase, then registration', async () => {
  const s = createSystems(), log = [];
  const sys = (id, phase, order) => ({ id, phase, ...(order != null ? { order } : {}), update: () => { log.push(id); } });
  s.add(sys('post-a', 'post')); s.add(sys('audio-a', 'audio')); s.add(sys('scene-a', 'scene')); s.add(sys('scene-b', 'scene'));
  s.add(sys('sim-a', 'sim')); s.add(sys('pre-late', 'pre', 5)); s.add(sys('pre-a', 'pre')); s.add(sys('pre-first', 'pre', -20));
  await s.run({});
  assert.deepEqual(log, ['pre-first', 'pre-a', 'pre-late', 'sim-a', 'scene-a', 'scene-b', 'audio-a', 'post-a']);
  assert.deepEqual(s.ids(), log);
  assert.deepEqual(PHASES, ['pre', 'sim', 'scene', 'audio', 'post']);
  log.length = 0; s.trace = []; await s.run({});
  assert.deepEqual(s.trace, log, 'the trace lists the systems as they ran');
});

test('add: an id, an update and a known phase; no id twice', () => {
  const s = createSystems();
  assert.throws(() => s.add({ id: 'x', phase: 'later', update() {} }), /phase/);
  assert.throws(() => s.add({ phase: 'pre', update() {} }), /id/);
  s.add({ id: 'x', phase: 'pre', update() {} });
  assert.throws(() => s.add({ id: 'x', phase: 'sim', update() {} }), /already/);
  assert.equal(s.size, 1); assert.ok(s.remove('x')); assert.equal(s.size, 0); assert.equal(s.remove('x'), null);
});

test('run: a promise is waited for before the next system; a plain return is not', async () => {
  const s = createSystems(), log = [];
  s.add({ id: 'slow', phase: 'pre', update: () => new Promise((ok) => setTimeout(() => { log.push('slow done'); ok(); }, 5)) });
  s.add({ id: 'next', phase: 'sim', update: () => { log.push('next'); } });
  await s.run({});
  assert.deepEqual(log, ['slow done', 'next']);
});

test('dispose: each system once, in the reverse of the frame order; the registry is empty after', async () => {
  const s = createSystems(), log = [];
  for (const [id, phase] of [['b', 'scene'], ['a', 'pre'], ['c', 'post']]) s.add({ id, phase, update() {}, dispose: () => log.push(id) });
  s.add({ id: 'none', phase: 'sim', update() {} });   // no dispose: skipped
  s.dispose();
  assert.deepEqual(log, ['c', 'b', 'a']);
  assert.equal(s.size, 0);
  s.dispose(); assert.equal(log.length, 3, 'a second dispose does nothing');
});

test('env: the storm writes rain and shelter before the birds and the sound read them, in the same frame', async () => {
  const env = createEnv(), s = createSystems(), seen = [];
  assert.deepEqual(env, { rain: 0, shelter: 0, hour: null, sun: null });
  let rain = 0;
  const storm = { update: (t, o) => { seen.push(['storm', t, o.hour]); rain = 0.4; }, get rain() { return rain; }, dispose() {} };
  s.add({ id: 'daylight', phase: 'pre', order: -10, update() { env.hour = 18.25; env.sun = { light: 1 }; } });
  s.add(stormSystem(storm, env));
  s.add({ id: 'birds', phase: 'scene', update() { seen.push(['birds', env.shelter]); } });
  s.add({ id: 'audio', phase: 'audio', update() { seen.push(['audio', env.rain]); } });
  await s.run({ t: 12 });
  assert.deepEqual(seen, [['storm', 12, 18.25], ['birds', Math.min(1, 0.4 * 1.5)], ['audio', 0.4]]);
  rain = 0.9; storm.update = () => {};   // shelter saturates at 1
  await s.run({ t: 13 });
  assert.equal(env.shelter, 1); assert.equal(env.rain, 0.9);
});

// stubs that log the module calls the old drawOnce made, by the same names as the browser recording
function frameWith(log, { birds = true, seen = {} } = {}) {
  const L = (name, ret) => () => { log.push(name); return ret; };
  const env = createEnv();
  const renderer = { info: { reset: L('info.reset'), render: { drawCalls: 7, triangles: 9, timestamp: 1 } }, domElement: { height: 720 }, resolveTimestampsAsync: async () => { log.push('resolveTimestamps'); }, backend: { isWebGPUBackend: true, trackTimestamp: true }, getPixelRatio: () => 1 };
  const water = { update: L('water.update'), ultra: { gpu: true, reads: true, settle: async () => { log.push('ultra.settle'); } } };
  const sun = { hour: 18.25, exposure: 6, light: 1, elevationDeg: 23 };
  let rain = 1;
  const storm = { update: L('storm.update'), get rain() { return rain; }, dispose() {} };
  const camera = { position: { x: 0, z: 0 } };
  const audio = { update: (t, st) => { log.push('audio.update'); audio.last = st; } };
  const systems = createSystems();
  for (const s of worldSystems({ storm, env, water, trees: { update: L('trees.update') }, landmarks: { update: L('landmarks.update') }, towns: { update: L('towns.update') },
    shoreFlags: { update: L('shoreFlags.update') }, birds: birds ? { setShelter: (x) => { log.push('birds.setShelter'); seen.shelter = x; }, update: L('birds.update'), dispose() {} } : null,
    audio, wind: null, terrain: null, camera, renderer })) systems.add(s);
  const pc = { post: { render: () => {} }, hud: { render: L('hud.render'), present: L('hud.present') } };
  const D = { inFlight: 0, renders: 0, maxInFlight: 0 };
  const frame = createFrame({ systems, renderer, pc, water, trees: { stats: {} }, quality: { name: 'high' }, sun, env,
    streamFrame: async () => { log.push('stream.update'); log.push('lod.update'); }, applyDaylight: () => { log.push('clock.tick'); log.push('daylight.update'); },
    CAM: 'A', SEED: 1, D, time: () => 0, headless: true });
  return { frame, systems, env, audio, D, setRain: (r) => { rain = r; } };
}

test('the frame calls the modules in exactly the recorded order of the old drawOnce (tests/fixtures/frame-order.json)', async () => {
  const log = [], seen = {};
  const { frame, systems, audio, D } = frameWith(log, { seen });
  systems.trace = [];
  await frame.renderOnce();
  assert.deepEqual(log, BASELINE.calls);
  assert.deepEqual(systems.trace, ['stream', 'daylight', 'storm', 'gpu-info', 'water', 'trees', 'landmarks', 'towns', 'shoreFlags', 'birds', 'audio', 'hud', 'draw']);
  assert.equal(seen.shelter, 1, 'the storm\'s rain 1: the birds in shelter');
  assert.equal(audio.last.rain, 1); assert.equal(audio.last.hour, 18.25);
  assert.equal(D.inFlight, 0); assert.equal(D.renders, 1);
  assert.equal(frame.stats().calls, 7); assert.deepEqual(frame.stats().callsPerFrame, [7]);
  // and the recording itself: its top-level calls are the baseline
  const raw = BASELINE.recorded.map((x) => x.replace(/\(.*$/, ''));
  assert.deepEqual(raw.filter((x, i) => !(x === 'info.reset' && raw[i - 1] !== 'storm.update')), BASELINE.calls);
});

test('the frame without birds: the same order, the birds left out', async () => {
  const log = [];
  const { frame } = frameWith(log, { birds: false });
  await frame.renderOnce();
  assert.deepEqual(log, BASELINE.calls.filter((c) => !c.startsWith('birds.')));
});

// the storm as a world system: idle until begin() (the boot's frames before the mode starts), then the same storm
function stormStubs() {
  const winds = [];
  const scene = { userData: {}, add() {}, remove() {} };
  const wind = { setStorm: (s) => winds.push(s), sample: () => ({ vx: 0, vz: 0, speed: 0, dirDeg: 0 }) };
  let t = 0;
  const env = createEnv();
  const storm = createStorm({ scene, camera: { position: { x: 100.4, z: -50.6 }, matrixWorld: { elements: [] }, projectionMatrixInverse: {} }, wind, seed: 1, env, now: () => t });
  return { storm, winds, env, setT: (v) => { t = v; } };
}

test('the storm: no update before begin(); start() hands the wind its state through setStorm, stop() clears it', () => {
  const { storm, winds, setT } = stormStubs();
  assert.equal(storm.update(0, { hour: 15 }).phase, 'none');
  assert.equal(storm.running, false); assert.equal(storm.rain, 0);
  setT(42);
  storm.begin({ natural: false });
  const st = storm.start({ s0: 10 });
  assert.equal(st.t0, 42, 'the scene clock as now()'); assert.deepEqual(st.ref, [100, -51]);
  assert.deepEqual(winds.at(-1), st);
  storm.stop();
  assert.equal(winds.at(-1), null); assert.equal(storm.running, false);
});

test('the wind field keeps a copy of the storm state (setStorm), and null when it ends', () => {
  const w = new WindField({ seed: 1 }), st = { s0: 10, t0: 42, rate: 1, ref: [100, -51], seed: 1 };
  w.setStorm(st);
  assert.deepEqual(w.storm, st); assert.notEqual(w.storm, st);
  w.setStorm(null); assert.equal(w.storm, null);
});

test('the storm: a natural storm counts its delay from begin(), not from when the world was made', () => {
  let seed = 1, plan = null;
  for (; seed < 200 && !(plan = naturalPlan(seed)); seed++);
  assert.ok(plan, 'some seed has a natural storm');
  const scene = { userData: {}, add() {}, remove() {} }, winds = [];
  let t = 0;
  const storm = createStorm({ scene, camera: { position: { x: 0, z: 0 } }, wind: { setStorm: (s) => winds.push(s) }, seed, env: createEnv(), now: () => t });
  // past start() the rain and the bolts need a GPU scene; the wind already has the state by then
  const at = (v) => { t = v; try { storm.update(v, { hour: 15 }); } catch { /* see above */ } };
  at(1000 + plan.atS);
  assert.equal(winds.length, 0, 'before begin(): no natural storm');
  t = 1000; storm.begin({ natural: true });   // the boot and the mode's start took 1000 s of scene time
  at(1000 + plan.atS - 1);
  assert.equal(winds.length, 0, 'not before plan.atS after begin()');
  at(1000 + plan.atS);
  assert.equal(winds.length, 1, 'the natural storm starts plan.atS after begin()');
  assert.equal(winds[0].t0, 1000 + plan.atS);
});

test('the frame\'s render stats count every pass of the post chain, not only the last (three\'s own rAF reset must not run)', async () => {
  const info = { autoReset: true, render: { drawCalls: 0, triangles: 0, timestamp: 1 }, reset() { this.render.drawCalls = 0; this.render.triangles = 0; } };
  const renderer = { info, domElement: { height: 720 }, resolveTimestampsAsync: async () => {}, backend: { isWebGPUBackend: true }, getPixelRatio: () => 1 };
  const sys2 = createSystems(), env = createEnv();
  const tick = () => { if (info.autoReset === true) info.reset(); };   // three's Animation.update, one rAF tick
  const pass = (calls, tris) => { tick(); info.render.drawCalls += calls; info.render.triangles += tris; };
  const pc = { post: { render: () => { pass(160, 3900000); pass(5, 2000); tick(); pass(2, 2); } }, hud: { render() {}, present() {} } };
  const D = { inFlight: 0, renders: 0, maxInFlight: 0 };
  const f = createFrame({ systems: sys2, renderer, pc, water: { update() {}, ultra: null }, trees: { stats: {} }, quality: { name: 'high' }, sun: { hour: 6, exposure: 1, light: 1, elevationDeg: 5 }, env,
    streamFrame: async () => {}, applyDaylight: () => {}, CAM: 'A', SEED: 1, D, time: () => 0, headless: true });
  assert.equal(info.autoReset, false, 'the frame owns the reset');
  await f.renderOnce();
  assert.equal(f.stats().calls, 167); assert.equal(f.stats().triangles, 3902002); assert.deepEqual(f.stats().callsPerFrame, [167]);
});

test('two renders in one animation tick both draw the scene pass (three runs it once per node frame id)', async () => {
  const nodeFrame = { frameId: 5, update() { this.frameId++; } };
  const info = { autoReset: true, render: { drawCalls: 0, triangles: 0, timestamp: 1 }, reset() { this.render.drawCalls = 0; this.render.triangles = 0; } };
  const renderer = { info, _nodes: { nodeFrame }, domElement: { height: 720 }, resolveTimestampsAsync: async () => {}, backend: { isWebGPUBackend: true }, getPixelRatio: () => 1 };
  let scenePassFrame = -1;
  const pc = { post: { render: () => {   // the scene pass: once per frame id; the output pass: every render
    if (scenePassFrame !== nodeFrame.frameId) { scenePassFrame = nodeFrame.frameId; info.render.drawCalls += 165; info.render.triangles += 3900000; }
    info.render.drawCalls += 2; info.render.triangles += 2; } }, hud: { render() {}, present() {} } };
  const D = { inFlight: 0, renders: 0, maxInFlight: 0 };
  const f = createFrame({ systems: createSystems(), renderer, pc, water: { update() {}, ultra: null }, trees: { stats: {} }, quality: { name: 'high' }, sun: { hour: 6, exposure: 1, light: 1, elevationDeg: 5 }, env: createEnv(),
    streamFrame: async () => {}, applyDaylight: () => {}, CAM: 'A', SEED: 1, D, time: () => 0, headless: true });
  await f.renderOnce(); await f.renderOnce(); await f.renderOnce();   // no tick between them
  assert.deepEqual(f.stats().callsPerFrame, [167, 167, 167]);
  nodeFrame.update();   // a live tick advances the id itself: no extra bump
  const id = nodeFrame.frameId; await f.renderOnce();
  assert.equal(nodeFrame.frameId, id); assert.equal(f.stats().calls, 167);
});
