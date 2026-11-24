// The controls split's seam test (refactor round 2, Phase C step 8): Sail's
// controls build the same elements in the same order (the body's and the head's children: equal z-index stacks by DOM
// order, a style's place is its place in the cascade) and leave the same listeners on the window and the canvas, at
// 1280 × 720 with a mouse and 390 × 844 with a finger. The fixture was recorded on main before the cut
// (tools/sail-order.mjs --write); a module built at a new point, or a listener on the wrong signal, fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { domOrder, DOM_CASES } from './helpers/sail-order.mjs';

const FX = JSON.parse(readFileSync(new URL('./fixtures/sail-dom-order.json', import.meta.url), 'utf8'));

for (const [k, o] of Object.entries(DOM_CASES)) {
  test(`DOM order, ${k} (${o.w} × ${o.h}${o.coarse ? ', coarse' : ''}): the body, the head and the listeners as on main`, () => {
    const got = domOrder(o);
    assert.deepEqual(got.mounted, FX[k].mounted, 'after the mount');
    assert.deepEqual(got.stepped, FX[k].stepped, 'after 3 frames');
    assert.deepEqual(got.window, FX[k].window, 'window listeners by type');
    assert.deepEqual(got.canvas, FX[k].canvas, 'canvas listeners by type');
  });
}

test('the fixture bites: a body child moved changes the order', () => {
  const b = [...FX.desktop.mounted.body];
  assert.ok(b.length > 4, `${b.length} body children`);
  [b[1], b[2]] = [b[2], b[1]];
  assert.notDeepEqual(b, FX.desktop.mounted.body);
});
