// The phone's build gate (v2/engine/buildGate.js; owner 2026-11-17: "For phones, the best experience is to build the shaders, then
// present"): the modes are ready only once every pipeline and the first view's assets are in; one honest percentage; the stage
// follows the group being built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildGate, PHONE_ORDER, stageOfGroup, STAGE_WORDS, ASSETS } from '../engine/buildGate.js';

const ALL = { lake: true, forest: true, towns: true };

test('off (a tablet, a desktop, a capture): open at once, 100 %', () => {
  const g = createBuildGate().configure({ on: false });
  assert.equal(g.ready, true); assert.equal(g.percent, 100); assert.equal(g.enabled, false);
  assert.equal(g.update({ built: 1, total: 9 }), false, 'an off gate ignores the page');
});

test('the modes are ready only after the build: every pipeline and the first view\'s assets', async () => {
  const g = createBuildGate().configure({ on: true });
  assert.equal(g.ready, false); assert.equal(g.stage, 'lake'); assert.equal(g.words, 'Filling the lake');
  let opened = false; g.whenReady().then(() => { opened = true; });
  g.update({ built: 33, total: 88, group: 'water-alt' });
  assert.equal(g.ready, false); assert.equal(g.percent, Math.floor((100 * 33) / 91));
  g.update({ built: 88, total: 88, group: null, assets: { lake: true, forest: true, towns: false } });
  assert.equal(g.ready, false, 'every pipeline but the towns\' data still out: not ready');
  assert.ok(g.percent < 100, 'never 100 before the gate opens'); assert.equal(g.stage, 'sails');
  g.update({ built: 87, total: 88, group: 'sweep', assets: ALL });
  assert.equal(g.ready, false, 'every asset but one pipeline still building: not ready');
  assert.equal(g.percent, 98);
  g.update({ built: 88, total: 88, group: null, assets: ALL }, 1234);
  assert.equal(g.ready, true); assert.equal(g.percent, 100); assert.equal(g.stage, 'ready'); assert.equal(g.words, 'Ready'); assert.equal(g.readyAt, 1234);
  await null; assert.equal(opened, true, 'whenReady resolves');
  g.update({ built: 1, total: 88 }); assert.equal(g.ready, true, 'once open it stays open');
});

test('the stage line follows the build: lake, forest, boat, sails, ready, in the phone\'s order', () => {
  const g = createBuildGate().configure({ on: true });
  const seen = [];
  g.on((s) => { if (seen.at(-1) !== s.words) seen.push(s.words); });
  const total = PHONE_ORDER.length + 1;   // one pipeline a group, plus core
  PHONE_ORDER.forEach((grp, i) => g.update({ built: 1 + i, total, group: grp }));
  g.update({ built: total, total, group: null, assets: ALL });
  assert.deepEqual(seen, ['Filling the lake', 'Raising the forest', 'Rigging the boat', 'Setting the sails', 'Ready']);
  assert.deepEqual(Object.values(STAGE_WORDS), seen);
  assert.equal(stageOfGroup('regatta'), 'sails'); assert.equal(stageOfGroup(null), 'lake');
});

test('the percentage counts pipelines and assets, one item each, and only ever rises with them', () => {
  const g = createBuildGate().configure({ on: true });
  let last = -1;
  for (let b = 0; b <= 60; b += 5) { g.update({ built: b, total: 60, group: 'forest', assets: { lake: b >= 30, forest: b >= 40, towns: b >= 50 } }); assert.ok(g.percent >= last); last = g.percent; }
  assert.equal(g.percent, 100);
  assert.equal(ASSETS.length, 3);
});

test('PHONE_ORDER: every group once (main.js PIPE_ORDER is the same set in a tablet\'s order)', () => {
  assert.equal(new Set(PHONE_ORDER).size, PHONE_ORDER.length);
  for (const g of ['boatModels', 'forest', 'water-alt', 'night', 'storm', 'regatta', 'kayaks', 'birds', 'sweep', 'tessie', 'fireworks']) assert.ok(PHONE_ORDER.includes(g), g);
});
