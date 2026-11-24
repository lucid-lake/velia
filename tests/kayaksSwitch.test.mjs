// fix/kayaks-mode-switch (the owner: after Cruise then Sail, "the kayaks become white color model without human move anim"):
// 1. after Cruise's hand-over (take the helm: Sail's controls attach in place, src/modes/chill/handover.js) the lake's kayakers
//    paddle on. On main 8014207 the hand-over's frame returned before the fleet's step, so from the take on every paddler
//    held its stroke and every kayak its tier (a kayak met close stayed the plain mid or far model).
// 2. the fleet's plain tiers (src/kayaks/fleet.js: the mid hull and torso, the far sliver) have their per-kayak colour buffer
//    from the start. three builds an instanced mesh's shader once, with the buffer it has then: on main a tier first drawn
//    before any kayak was in it drew white for the fleet's life (Cruise → Sail by the menu: the far kayaks white).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createHandover } from '../classic/src/modes/chill/handover.js';
import { attachKayakFleet } from '../classic/src/kayaks/fleet.js';
import { makeTerrain } from '../src/sim/terrain.js';
import { createServices } from '../src/sim/core/services.js';

const core = { flags: {}, camera: {}, services: { get: () => null, provide: () => {} } };
const passenger = { sched: null, makeMusic: () => null, down: new Set(), helmPick: {}, canvas: null, mods: async () => [], mountPassenger: () => null, mountTools: () => {}, unmountTools: () => null };

test('while Sail\'s controls have the boat, each frame steps the kayak fleet on the frame time', () => {
  const steps = [], fleet = { update: (dt, camDt) => steps.push([dt, camDt]) };
  const cx = { controls: null, blend: null };
  const H = createHandover(core, {}, cx, passenger, { coreOptions: () => ({}), kayaks: () => fleet });
  assert.equal(H.update(1 / 60, 1 / 60), false, 'no controls: Cruise\'s own frame runs (and steps the fleet itself)');
  assert.equal(steps.length, 0);
  cx.controls = { update() {} };
  for (let i = 0; i < 3; i++) assert.equal(H.update(1 / 60, 1 / 60), true);
  assert.deepEqual(steps, [[1 / 60, 1 / 60], [1 / 60, 1 / 60], [1 / 60, 1 / 60]]);
});

test('no fleet (?kayaks=0, or before it attaches): the hand-over frame still runs', () => {
  const cx = { controls: { update() {} }, blend: null };
  const H = createHandover(core, {}, cx, passenger, { coreOptions: () => ({}), kayaks: () => null });
  assert.equal(H.update(1 / 60, 1 / 60), true);
});

test('the plain tiers carry their colour buffer before any kayak is in them (a first draw then keeps the colours)', async () => {
  // the camera far off the bay: no kayak is mid when the fleet attaches
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 5000); camera.position.set(1e5, 3, 1e5);
  const fleet = await attachKayakFleet({ scene, camera, water: { surface: { heightAt: () => 0 } }, terrain: makeTerrain(), services: createServices(), flags: {}, headless: false, time: 0, SEED: 1 }, null);
  try {
    assert.equal(fleet.stats().tiers.mid, 0);
    for (const n of ['kayak-mid-hull', 'kayak-mid-torso', 'kayak-far-hull']) {
      const im = scene.getObjectByName(n);
      assert.ok(im?.isInstancedMesh && im.instanceColor, `${n}: a colour buffer at attach`);
      assert.equal(im.instanceColor.count, im.instanceMatrix.count, `${n}: one colour per instance`);
    }
  } finally { fleet.dispose(); }
});
