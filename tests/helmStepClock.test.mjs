// The helm's step buttons on the scene clock (refactor round 2, A4): a held ▲/▼ turns into a held key after HELM_IN.holdMs
// of the station's own time (its update(dt)), not of the wall clock, so a film or a golden that steps the frames sees the
// same thing every run (hud-calm read performance.now() here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { installDom, memStorage } from './helpers/dom-helm.mjs';
import { HELM_IN } from '../src/stations/sloop/helmInput.js';

test('a held step button repeats after holdMs of scene time, however long the wall clock took', async () => {
  const dom = installDom();
  try {
    const { createHelmStation } = await import('../classic/src/stations/sloop/helmStation.js');
    const helm = createHelmStation({ hud: null, camera: new THREE.PerspectiveCamera() }, { boat: { modules: { wheel: new THREE.Group(), cockpit: new THREE.Group() } },
      state: () => ({ heading: 0, rudder: 0, sog: 0 }), storage: memStorage(), once: true });
    helm.update(0.1);
    const btn = helm.el.querySelector('.stp[data-w="main"] button[data-d="1"]');
    assert.ok(btn, 'the main sheet\'s pull-in button');
    const ev = Object.assign(new Event('pointerdown', { bubbles: true }), { pointerType: 'mouse', button: 0, pointerId: 1 });
    btn.dispatchEvent(ev);
    assert.equal(helm.hold('main'), 0, 'just pressed: one step, not yet held');
    const wall = performance.now(); while (performance.now() - wall < HELM_IN.holdMs + 50) { /* the wall clock runs past holdMs */ }
    assert.equal(helm.hold('main'), 0, 'no scene time has passed: still a click');
    for (let i = 0; i < Math.ceil(HELM_IN.holdMs / 50) + 1; i++) helm.update(0.05);
    assert.equal(helm.hold('main'), 1, 'past holdMs of scene time: held, pulling in');
  } finally { dom.uninstall?.(); }
});
