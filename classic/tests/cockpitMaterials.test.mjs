// The cockpit overlay's baked sole occlusion (src/stations/sloop/cockpitMaterials.js soleAoData): dark at the coaming's foot and round a post,
// open in the middle of the sole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soleAoData } from '../src/stations/sloop/cockpitMaterials.js';

test('sole AO: darker at the coaming foot and round a post, open in the middle', () => {
  const W = 64, H = 32, box = { x0: -2, x1: 2, z0: -2, z1: 0 };
  const pts = [[-2, -1.9], [2, -1.9]];   // the coaming's foot along the forward edge
  const d = soleAoData(pts, box, [[1, -0.5, 0.05, 0.4]], W, H);
  const at = (x, z) => { const i = Math.floor((x - box.x0) / (box.x1 - box.x0) * W), j = Math.floor((z - box.z0) / (box.z1 - box.z0) * H); return d[4 * (j * W + i)] / 255; };
  const foot = at(0, -1.9), open = at(-1, -0.5), post = at(1.06, -0.5);
  assert.ok(foot < 0.6, `foot ${foot}`);
  assert.ok(open > 0.97, `open ${open}`);
  assert.ok(post < 0.85 && post < open, `post ${post}`);
  assert.equal(d.length, W * H * 4);
});

// look/cockpit-light: by the world's light the cockpit adds no light of its own (the boat has none): the bounce is the world's
// night light (its intensity and colours) and the lamp is off; the old rig holds a screen level (about noon's at dusk).
test('cockpit light: the world rig adds nothing but the night light; the old lamp holds the screen level', async () => {
  const THREE = await import('three/webgpu');
  const { createCockpitLight } = await import('../src/stations/sloop/cockpitMaterials.js');
  const screen = (rig, lamp, exp, light, nightLight = null) => {
    lamp.intensity = (0.6 / exp) * (0.9 + 14 * (1 - light) ** 2);   // hud3d's deck lamp
    rig.apply(lamp, { night: 0, light, lum: 0.6 / exp, comp: 6 / exp, nightLight });
    return rig.bounce.intensity * exp + lamp.intensity * exp;   // on screen (x the exposure)
  };
  const lamp = new THREE.DirectionalLight(0xffffff, 0);
  const W = createCockpitLight(new THREE.Group(), { world: true }), O = createCockpitLight(new THREE.Group());
  assert.ok(screen(O, lamp, 16, 0.25) > 0.8 * screen(O, lamp, 6, 1), 'the old rig: dusk about as bright on screen as noon');
  assert.equal(screen(W, lamp, 6, 1), 0, 'by day nothing of its own');
  assert.equal(screen(W, lamp, 16, 0.25), 0, 'at dusk nothing of its own');
  const nl = new THREE.HemisphereLight(0x9fb6dc, 0x10161f, 1e-3);
  screen(W, lamp, 2172, 5e-4, nl);
  assert.equal(W.bounce.intensity, 1e-3);
  assert.equal(lamp.intensity, 0);
  assert.equal(W.bounce.color.getHex(), 0x9fb6dc);
  assert.equal(W.bounce.groundColor.getHex(), 0x10161f);
});
