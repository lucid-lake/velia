// The controls split's frame order (refactor round 2, Phase C step 8): one
// update(1/60) of Sail's controls, after three warm frames, calls the physics, the drawn boat, the cameras, the pose onto
// the camera, the sounds, the clock, the dock, the hint and the bar in the order main did (the follow view, the helm view,
// a phone). The fixture was recorded on main before the cut (tools/sail-order.mjs --write); a camera chain or a dock
// update moved a line early or late fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frameOrder, FRAME_CASES } from './helpers/sail-order.mjs';

const FX = JSON.parse(readFileSync(new URL('./fixtures/sail-frame-order.json', import.meta.url), 'utf8'));

for (const [k, o] of Object.entries(FRAME_CASES)) {
  test(`frame order, ${k}: one update's calls as on main`, () => {
    const got = frameOrder(o);
    assert.ok(got.includes('sim.step') && got.includes('camera.position.set') && got.includes('core.setTime'), got.join(' '));
    assert.deepEqual(got, FX[k]);
  });
}

test('the helm view runs the helm camera; the follow view does not', () => {
  assert.ok(FX.helm.includes('helmCam.update'));
  assert.ok(!FX.follow.includes('helmCam.update'));
});
