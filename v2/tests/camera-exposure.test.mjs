// The camera's pose from the URL (v2/engine/camera.js): v1's presets pose for pose, so a v1 and a v2 capture of the same
// ?cam= compare; the proof rows; the yaw turn. The exposure (v2/sim/exposure.js): the base at a high sun, a partial
// adaptation toward dusk, capped, linear in the URL's exposure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraPose, NEAR, FOV } from '../engine/camera.js';
import { exposureFactor, EXPOSURE, NIGHT_GAIN, NIGHT_KNOTS, nightGain, groundLight, waterKeep, stormExposure } from '../sim/exposure.js';
import { exposureAt } from '../../src/sim/timeOfDay.js';
const ef2 = (x, e, E = undefined, m = 0) => exposureFactor(x, e, E, m, 'v2');   // M2's camera (?look=v2)
import { CAMERAS } from '../../src/sim/core/presets.js';

const close = (a, b, e = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < e);

test('cam A and B are v1\'s presets: the same eye, the same look direction, v1\'s 50° and 0.5 m near', () => {
  for (const k of ['A', 'B', 'I', 'O']) {
    const p = cameraPose({ cam: k }), P = CAMERAS[k];
    assert.deepEqual(p.eye, P.pos);
    const d = P.look.map((x, i) => x - P.pos[i]), l = Math.hypot(...d);
    assert.ok(close(p.fwd, d.map((x) => x / l)), `${k} looks at its preset's target`);
    assert.equal(p.fovDeg, P.fov ?? FOV); assert.equal(p.near, NEAR);
  }
  assert.deepEqual(cameraPose({}).eye, CAMERAS.A.pos, 'no cam: A, as v1');
  assert.deepEqual(cameraPose({ cam: 'Z' }).eye, CAMERAS.A.pos, 'an unknown preset: A');
});

test('campos/camlook, camyaw/campitch and camfov', () => {
  const p = cameraPose({ campos: '10,5,-20', camlook: '10,5,-120', camfov: '35' });
  assert.deepEqual(p.eye, [10, 5, -20]); assert.ok(close(p.fwd, [0, 0, -1])); assert.equal(p.fovDeg, 35); assert.equal(p.cam, 'pos');
  const y = cameraPose({ cam: 'B', camyaw: '90' });
  assert.deepEqual(y.eye, CAMERAS.B.pos); assert.ok(y.fwd[0] > 0.99, 'yaw 90: east'); assert.ok(Math.abs(Math.asin(y.fwd[1]) * 180 / Math.PI - 2) < 1e-9, 'a yaw alone: 2° up');
  const t = cameraPose({ cam: 'B', campitch: '-10' });
  assert.ok(Math.abs(Math.asin(t.fwd[1]) * 180 / Math.PI + 10) < 1e-9, 'a pitch alone keeps the preset\'s yaw');
});

test('M2 exposure (?look=v2, the A/B): the base for a high sun, more toward dusk, capped, linear in ?exposure', () => {
  assert.ok(Math.abs(ef2(6, 70) - EXPOSURE.base) < 1e-12);
  assert.ok(Math.abs(ef2(6, 85) - EXPOSURE.base) < 1e-12, 'never darker than the base');
  const noon = ef2(6, 72), seven = ef2(6, 15), dusk = ef2(6, 4), night = ef2(6, -20);
  assert.ok(noon < seven && seven < dusk && dusk <= night, 'more light → less exposure');
  assert.ok(dusk / noon > 2.5 && dusk / noon < 3.5, `about 3× at +4° (before the night's ramp): ${(dusk / noon).toFixed(2)}`);
  assert.ok(ef2(6, -1) / nightGain(-1) <= EXPOSURE.base * EXPOSURE.maxGain + 1e-12, 'the dusk gain is capped at the horizon (before the night gain)');
  // M5e: the night adapts further, × NIGHT_GAIN by the night (look/v2-night-look: from the sun's +3.5°, full by the last knot), a smooth rise with no step
  assert.ok(Math.abs(night - EXPOSURE.base * Math.min(EXPOSURE.maxGain, Math.sqrt(groundLight(70) / groundLight(-20))) * NIGHT_GAIN) < 1e-9, "the night's cap: the dusk gain × NIGHT_GAIN");
  let prev = ef2(6, 5);
  for (let e = 5; e >= -20; e -= 0.05) { const f = ef2(6, e); assert.ok(f >= prev - 1e-12 && f / prev < 1.03, `monotone and smooth at ${e}°`); prev = f; }
  const last = NIGHT_KNOTS[NIGHT_KNOTS.length - 1][0];
  assert.ok(nightGain(NIGHT_KNOTS[0][0]) === 1 && nightGain(10) === 1 && Math.abs(nightGain(last) - NIGHT_GAIN) < 1e-9 && nightGain(last - 10) === NIGHT_GAIN, 'the night gain: 1 above the first knot, full from the last');
  assert.ok(NIGHT_KNOTS[0][0] > 3 && last >= -8, 'the ramp starts after the 20:00 frames (sun +4.2°) and is full by −8°, where the sky goes black');
  // a moonlit night is exposed down: by the moon's full share at full night, by nothing by day
  assert.ok(Math.abs(ef2(6, -20, undefined, 1) - night / 2) < 1e-9, 'half under a full moon high');
  assert.ok(Math.abs(ef2(6, 40, undefined, 1) - ef2(6, 40)) < 1e-12, 'the moon by day changes nothing');
  assert.ok(Math.abs(ef2(3, 72) - noon / 2) < 1e-12, 'linear in the URL\'s exposure (6 = the base)');
});

// fix(v2) frame look: v1's camera by default: v1's day schedule (src/sim/timeOfDay.js exposureAt: one exposure above the sun's
// +8.5°, 70 % of the lost stops back below) at EXPOSURE.v1Base, and v2's own night (M2's adaptation × the night gain at
// EXPOSURE.nightBase), whichever is lower
test('v1 exposure: v1 held by day (18:45 no brighter than noon), v2\'s night past the horizon, continuous and monotone', () => {
  for (const e of [72, 40, 17, 12.5, 9, 6, 4]) assert.ok(Math.abs(exposureFactor(6, e) - EXPOSURE.v1Base * exposureAt(e) / 6) < 1e-12, `v1's schedule at ${e}°`);
  assert.equal(exposureFactor(6, 12.5), exposureFactor(6, 72), 'the 18:45 sun (12.5° up) is exposed as noon (M2 had it 2 × brighter)');
  assert.ok(ef2(6, 12.5) / ef2(6, 72) > 1.9, 'M2 for the record: about 2 × at 12.5°');
  for (const e of [-3, -8, -14, -20]) assert.ok(Math.abs(exposureFactor(6, e) - ef2(6, e) * EXPOSURE.nightBase / EXPOSURE.base) < 1e-12, `v2's night at ${e}°`);
  let prev = exposureFactor(6, 10);
  for (let e = 10; e >= -20; e -= 0.05) { const f = exposureFactor(6, e); assert.ok(f >= prev - 1e-12 && f / prev < 1.035, `monotone and smooth at ${e}°: ${(f / prev).toFixed(4)}`); prev = f; }   // the cross-over sits on v1's own steepest stretch (1.055 per 0.1° just over the horizon)
  assert.ok(Math.abs(exposureFactor(6, -20, undefined, 1) - exposureFactor(6, -20) / 2) < 1e-9, 'the moon still halves the full night');
  assert.ok(Math.abs(exposureFactor(3, 40) - exposureFactor(6, 40) / 2) < 1e-12, 'linear in ?exposure');
});


// fix(v2) frame look: the water past the shelf is never exposed brighter than M2 exposed it (the navy kept)
test('the water keep: M2 over v1 at noon, 1 from the afternoon on and at night, never above 1', () => {
  assert.ok(Math.abs(waterKeep(6, 73) - EXPOSURE.base / EXPOSURE.v1Base) < 1e-9, 'noon: base / v1Base');
  for (const e of [25, 12.5, 4, 0, -5, -14, -20]) assert.equal(waterKeep(6, e), 1, `${e}°`);
  for (let e = -20; e <= 90; e += 0.5) { const k = waterKeep(6, e); assert.ok(k > 0 && k <= 1, `${e}°: ${k}`); }
  assert.ok(Math.abs(waterKeep(3, 73) - waterKeep(6, 73)) < 1e-12, 'independent of ?exposure');
});

// fix(v2) frame look, the storm: never under M2's adaptation under a storm's dark (its content was tuned on M2's camera)
test('the storm exposure: v1 by noon, M2 toward dusk, by the storm\'s dark, the water keep against it', () => {
  for (const e of [73, 40]) assert.equal(stormExposure(exposureFactor(6, e), 6, e, 0, 1), exposureFactor(6, e), `${e}°: v1's (the higher)`);
  const f4 = exposureFactor(6, 4), m4 = ef2(6, 4);
  assert.ok(Math.abs(stormExposure(f4, 6, 4, 0, 1) - m4) < 1e-12 && m4 > f4 * 1.5, '20:00: M2\'s');
  assert.ok(Math.abs(stormExposure(f4, 6, 4, 0, 0.5) - (f4 + m4) / 2) < 1e-12, 'half dark: half way');
  assert.equal(stormExposure(f4, 6, 4, 0, 0), f4, 'no storm: unchanged');
  assert.equal(waterKeep(6, 4, 0, stormExposure(f4, 6, 4, 0, 1)), 1, 'the water keep is against the frame\'s factor');
});