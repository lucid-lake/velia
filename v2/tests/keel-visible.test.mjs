// The keel over and under the real water (fix/v2-keel-visible; owner, 2026-11-18: "Do we have a keel under the sailboat? When it
// capsizes I didn't notice it"): what draws in the air and what is seen through the water is decided at each point's world
// position against the drawn water there (render/boat/waterline.js), not by the hull frame's waterline. Behaviour only: the
// boat posed as render/boat.js poses her (position · Ry(−heading) · Rx(pitch) · Rz(−heel)), points of the keel and the rudder
// taken to the world, the module asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPatch, patchHeight, underWeight, PATCH, PATCH_FLOATS, WATERLINE_WGSL } from '../render/boat/waterline.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';

const DEG = Math.PI / 180;
const { HULL } = DEFAULT_DIMS;
// the hull frame → the world (render/boat.js update's chain), for a point p = [x, y, z]
function toWorld({ x = 0, heave = 0, z = 0, heading = 0, pitch = 0, heel = 0 }, p) {
  // Rz(−heel)
  let [px, py, pz] = p; let c = Math.cos(-heel), s = Math.sin(-heel);
  [px, py] = [c * px - s * py, s * px + c * py];
  // Rx(pitch)
  c = Math.cos(pitch); s = Math.sin(pitch); [py, pz] = [c * py - s * pz, s * py + c * pz];
  // Ry(−heading)
  c = Math.cos(-heading); s = Math.sin(-heading); [px, pz] = [c * px + s * pz, -s * px + c * pz];
  return [px + x, py + heave, pz + z];
}
// the root's z column in the world (the patch's along axis, as render/boat.js passes M[8], M[10])
const alongOf = (pose) => { const a = toWorld({ ...pose, x: 0, heave: 0, z: 0 }, [0, 0, 1]); return [a[0], a[2]]; };
const KEEL_TIP = [0, -HULL.draft + 0.05, 0.2];       // the fin's tip, a little forward of the middle (hull frame)
const RUDDER_TIP = [0, -1.1, HULL.rudderZ];          // the rudder's blade low down
const patchFor = (pose, water) => { const W = new Float32Array(PATCH_FLOATS); const [ux, uz] = alongOf(pose); return fillPatch(W, pose.x ?? 0, pose.z ?? 0, ux, uz, water); };
const weightAt = (W, pose, p) => { const w = toWorld(pose, p); return underWeight(W, w[0], w[1], w[2], p[1]); };

test('upright on flat water: the keel and the rudder are under it, the topsides and deck in the air', () => {
  const pose = { x: 120, z: -40, heading: 0.7, heel: 4 * DEG };
  const W = patchFor(pose, 0);
  assert.equal(weightAt(W, pose, KEEL_TIP), 1, 'the keel tip under the water');
  assert.equal(weightAt(W, pose, RUDDER_TIP), 1, 'the rudder under the water');
  assert.equal(weightAt(W, pose, [HULL.beam * 0.45, 0.4, 0]), 0, 'the topsides in the air');
  assert.equal(weightAt(W, pose, [0, 0.9, 1.5]), 0, 'the deck in the air');
});

test('heeled 30–45°: the keel tip stays under flat water; only a trough deep enough brings it out', () => {
  for (const h of [30, 38, 45]) {
    const pose = { heading: 2.1, heel: h * DEG };
    assert.ok(weightAt(patchFor(pose, 0), pose, KEEL_TIP) > 0.99, `${h}°: the keel tip under flat water`);
  }
  // at 45° the tip sits about 1.1 m down: a 0.5 m trough leaves it under, a 1.3 m one (a storm's) brings it out
  const pose = { heading: 2.1, heel: 45 * DEG };
  const tip = toWorld(pose, KEEL_TIP);
  assert.ok(weightAt(patchFor(pose, -0.5), pose, KEEL_TIP) > 0.99, `a 0.5 m trough: still under (tip at ${tip[1].toFixed(2)} m)`);
  assert.equal(weightAt(patchFor(pose, tip[1] - 0.05), pose, KEEL_TIP), 0, 'the water under the tip: in the air');
});

// on her side she floats on her lee topsides: the hull frame's origin (the waterline's middle) rides about half a beam's
// immersion over the water (heave 0.5 m here)
test('knocked down (the hull frame keeps the keel at y < 0): the keel and the rudder are in the air, drawn lit', () => {
  for (const h of [85, 90, 100]) {
    const pose = { x: -300, z: 800, heave: 0.5, heading: -1.2, heel: h * DEG };
    const W = patchFor(pose, 0);
    const tip = toWorld(pose, KEEL_TIP);
    assert.ok(tip[1] > 0.2, `${h}°: the keel tip ${tip[1].toFixed(2)} m over the water`);
    assert.equal(weightAt(W, pose, KEEL_TIP), 0, `${h}°: the keel tip drawn in the air`);
    assert.equal(weightAt(W, pose, [0, -0.6, 0.2]), 0, `${h}°: the keel's root in the air`);
    assert.ok(weightAt(W, pose, RUDDER_TIP) < 0.05, `${h}°: the rudder in the air`);
    // the lee side of the hull is under: the bilge on the low side takes the water
    assert.ok(weightAt(W, pose, [HULL.beam * 0.45, -0.1, 0]) > 0.5, `${h}°: the lee bilge under the water`);
    // at 75° the tip is still under flat water: seen through it (not cut out), as the physics says
  }
  { const pose = { heave: 0.1, heel: 75 * DEG }; const tip = toWorld(pose, KEEL_TIP);
    assert.ok(tip[1] < -0.1 && weightAt(patchFor(pose, 0), pose, KEEL_TIP) === 1, `75°: the tip ${tip[1].toFixed(2)} m under: through the water`);
  }
  // the deck and the cockpit never take the water, even under it (no water inside the hull or the cockpit)
  const pose = { heel: 90 * DEG };
  assert.equal(weightAt(patchFor(pose, 0), pose, [HULL.beam * 0.4, 0.8, 1.5]), 0, 'the submerged lee deck: no water look');
});

test('Tessie\'s strike roll and a rival heeling read the same rule (the patch is per boat, in her own axes)', () => {
  // a roll the other way with pitch (her tail's push), a wave over the bow: the keel out, the bow's underbody under the crest
  const pose = { x: 40, z: 40, heave: 0.5, heading: 0.3, pitch: -6 * DEG, heel: -88 * DEG };
  const crest = (x, z) => 0.4 * Math.sin((x - 40) * 0.6 + (z - 40) * 0.2);
  const W = patchFor(pose, crest);
  assert.equal(weightAt(W, pose, KEEL_TIP), 0, 'the keel out in the strike roll');
  // the patch follows the water within a few cm over the hull (bilinear on a 2.4 × 2.0 m grid against a 10 m wave)
  let worst = 0;
  for (let a = -4; a <= 4; a += 0.5) for (let b = -2; b <= 2; b += 0.5) {
    const [ux, uz] = alongOf(pose), x = 40 + a * ux - b * uz, zz = 40 + a * uz + b * ux;
    worst = Math.max(worst, Math.abs(patchHeight(W, x, zz) - crest(x, zz)));
  }
  assert.ok(worst < PATCH.blendM * 0.6, `the patch within ${worst.toFixed(3)} m of the water (blend ${PATCH.blendM} m)`);
});

test('a soft waterline: the weight rises smoothly over the blend, no step', () => {
  const W = fillPatch(new Float32Array(PATCH_FLOATS), 0, 0, 0, 1, 0);
  let prev = -1;
  for (let d = -0.05; d <= PATCH.blendM + 0.05; d += 0.005) {
    const k = underWeight(W, 0, -d, 0, -0.5);
    assert.ok(k >= prev - 1e-12 && k - Math.max(prev, 0) < 0.12, `monotone and gentle at ${d.toFixed(3)} m (${k.toFixed(3)})`);
    prev = k;
  }
  assert.equal(underWeight(W, 0, 0.01, 0, -0.5), 0); assert.equal(underWeight(W, 0, -PATCH.blendM, 0, -0.5), 1);
  // no patch (a slot without one): never under water
  assert.equal(underWeight(new Float32Array(PATCH_FLOATS), 0, -5, 0, -1), 0);
  assert.match(WATERLINE_WGSL, /fn underWeight/);
});
