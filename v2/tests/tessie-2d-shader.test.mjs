// Play as Tessie, phase 2d step 7: the flipper's paddle and the jaw's gape as two vertex terms on her rest pose. The
// shader's text is built and linted here (the GPU compiles it in v2/tests/pages/tessie.page.mjs and safariWgsl.page.mjs); the sim's side
// (the paddle's phase and angle, the gape) is in v2/tests/tessie-2d-motion.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_WGSL, BODY_UNDER_WGSL, POSE } from '../render/tessie.js';
import { lintWgsl } from '../engine/wgsl-lint.js';
import { BITE2 } from '../sim/tessie.js';

test('the body\'s module carries the pose (paddle, gape) in every vertex entry, one more vec4 of uniforms, and lints clean', () => {
  const w = BODY_WGSL('') + BODY_UNDER_WGSL();
  assert.match(w, /struct TessU \{ sp: array<vec4f, 128>, p: vec4f, q: vec4f, r: vec4f \}/);
  for (const fn of ['fn pose(', 'fn jawK(', 'fn creaseDark(']) assert.ok(w.includes(fn), fn);
  assert.equal((w.match(/pose\(p0, n/g) ?? []).length, 2, 'place() and vsUnder() both pose the rest point');
  assert.deepEqual(lintWgsl(w, 'tessie-body'), []);
});

test('the jaw opens at most 15° (the owner\'s default: the skin stretched closed, no teeth); its hinge behind the mouth\'s line', () => {
  assert.equal(POSE.gapeMax, 15);
  assert.ok(Math.max(...Object.values(BITE2).map((b) => b.gape)) <= POSE.gapeMax);
  assert.ok(POSE.hinge > POSE.mouth + POSE.corner, 'the hinge behind the mouth\'s corners');
  assert.ok(POSE.fore[0] < POSE.split && POSE.hind[0] > POSE.split, 'the fore and hind flipper roots on either side of the split');
});
