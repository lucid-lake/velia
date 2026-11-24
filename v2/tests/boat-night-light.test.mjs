// fix(v2) boat night light (owner, 2026-11-18: "the boat itself can't be this bright"; render/boat.js BOAT_LIGHT, NAV_LIGHT): the
// boat's own navigation lights light her locally. No browser: the lenses written into the Shadow record (navLightsInto) sit where
// the hull's matrix puts v1's lens points, carry v1's level (dark by day, lit from sunset), follow COLREGs' modes (sidelights and
// sternlight under sail, the all-round anchor light alone at anchor), and the hull's forward is the flattened −z of her frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { navLightsInto, SHADOW_U_FLOATS, NAV_LIGHT, BOAT_LIGHT } from '../render/boat.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';
import { LAND_SKY } from '../render/sky.js';

const H = DEFAULT_DIMS.HULL, MAST = [0, H.mastStepY + DEFAULT_DIMS.RIG.mastTop + 0.05, H.mastStepZ];
// T(x, 0, z) · Ry(−heading), column-major (render/boat.js's root for a level hull)
const root = (x, z, heading) => { const c = Math.cos(-heading), s = Math.sin(-heading); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, 0, z, 1]; };
const at = (u, row) => [u[20 + row * 4], u[21 + row * 4], u[22 + row * 4], u[23 + row * 4]];
const close = (a, b, eps = 1e-5) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('the Shadow record holds the lenses after vp and dir', () => {
  assert.equal(SHADOW_U_FLOATS, 36);
  const u = new Float32Array(SHADOW_U_FLOATS); u[19] = 7;
  navLightsInto(u, root(0, 0, 0), -20, false, H, MAST);
  assert.equal(u[19], 7, 'the sun row is left alone');
});

test('the lenses: v1\'s points by the hull\'s matrix, the forward flattened', () => {
  const u = new Float32Array(SHADOW_U_FLOATS);
  navLightsInto(u, root(100, -50, 0), -20, false, H, MAST);
  assert.ok(close(at(u, 0).slice(0, 3), [100 + H.navBow[0], H.navBow[1], -50 + H.navBow[2] - 0.05]), 'the bow lens');
  assert.ok(close(at(u, 1).slice(0, 3), [100 + H.navStern[0], H.navStern[1], -50 + H.navStern[2] + 0.05]), 'the stern lens');
  assert.ok(close(at(u, 2).slice(0, 3), [100, MAST[1], -50 + MAST[2]]), 'the truck');
  assert.ok(close(at(u, 3).slice(0, 3), [0, 0, -1]), 'heading 0: forward is −z');
  navLightsInto(u, root(0, 0, Math.PI / 2), -20, false, H, MAST);
  assert.ok(close(at(u, 3).slice(0, 3), [1, 0, 0]), 'heading 90°: forward is +x (east)');
});

test('the modes and the level: dark by day, sidelights and sternlight under sail, the anchor light alone at anchor', () => {
  const u = new Float32Array(SHADOW_U_FLOATS), M = root(0, 0, 0);
  navLightsInto(u, M, 20, false, H, MAST);
  assert.deepEqual([at(u, 0)[3], at(u, 1)[3], at(u, 2)[3]], [0, 0, 0], 'the sun 20° up: none lit');
  navLightsInto(u, M, -10, false, H, MAST);
  assert.deepEqual([at(u, 0)[3], at(u, 1)[3], at(u, 2)[3]], [1, 1, 0], 'under sail at night: bow and stern');
  navLightsInto(u, M, -10, true, H, MAST);
  assert.deepEqual([at(u, 0)[3], at(u, 1)[3], at(u, 2)[3]], [0, 0, 1], 'at anchor: the anchor light only');
});

test('the light\'s numbers: the land\'s night fade, a local reach', () => {
  assert.deepEqual(BOAT_LIGHT.nightDeg, LAND_SKY.nightDeg, 'the boat\'s day terms go as the land\'s');
  assert.ok(BOAT_LIGHT.night > 0 && BOAT_LIGHT.night <= 1, 'the night light never lifted over the land\'s');
  assert.ok(NAV_LIGHT.reach <= 8 && NAV_LIGHT.k > 0, 'the lenses light only the boat they are on');
});
