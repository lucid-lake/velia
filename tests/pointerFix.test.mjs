// Pointer-only fixes: two-finger look and pinch zoom, the home plan race, the Tack pill's place. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TwoFinger, LOOK } from '../src/ui/touchLook.js';
import { createPlan } from '../src/ui/planState.js';
import { tackButtonPos } from '../src/stations/sloop/tackButton.js';
import { GROUPS, HANDS } from '../src/ui/keysContent.js';

test('one finger is never a look or a zoom', () => {
  const g = new TwoFinger();
  assert.equal(g.down(1, 100, 100), false);
  assert.equal(g.move(1, 160, 140), null);
  assert.equal(g.active, false);
});

test('two fingers moving together look round; the midpoint sets the orbit', () => {
  const g = new TwoFinger();
  g.down(1, 100, 200); g.down(2, 200, 200); assert.equal(g.active, true);
  const r1 = g.move(1, 140, 220), r2 = g.move(2, 240, 220);
  assert.ok(r1.look[0] > 0 && r2.look[0] > 0 && r2.look[1] > 0);
  assert.ok(Math.abs(r1.look[0] + r2.look[0] - 40 * LOOK.dragX) < 1e-9, 'the midpoint moved 40 px in all');
  assert.ok(Math.abs(r1.zoom * r2.zoom - 1) < 1e-9, 'same spread at the end: no net zoom');
  g.up(2); assert.equal(g.move(1, 150, 230), null, 'one finger left: nothing');
});

test('pinch: fingers apart zoom in (factor < 1), together zoom out (> 1); clamped; tiny spreads ignored', () => {
  const g = new TwoFinger();
  g.down(1, 100, 300); g.down(2, 200, 300);
  const out = g.move(2, 300, 300);                       // spread 100 → 200
  assert.ok(out.zoom < 1 && out.zoom >= LOOK.zoomMin);
  const inn = g.move(2, 200, 300);                       // spread 200 → 100
  assert.ok(inn.zoom > 1 && inn.zoom <= LOOK.zoomMax);
  const big = new TwoFinger(); big.down(1, 0, 0); big.down(2, 40, 0);
  assert.equal(big.move(2, 400, 0).zoom, LOOK.zoomMin, 'a jump is clamped');
  const tiny = new TwoFinger(); tiny.down(1, 0, 0); tiny.down(2, 10, 0);
  assert.equal(tiny.move(2, 14, 0).zoom, 1, 'under the minimum spread');
  // a third finger never makes a gesture
  g.down(3, 50, 50); assert.equal(g.active, false); assert.equal(g.move(3, 60, 60), null);
});

test('plan race: Cruise then Sail within one switch, the last pick wins and Enter starts it', () => {
  const P = createPlan('sail');
  assert.equal(P.pick('cruise'), true);                  // the shell starts the Cruise switch
  assert.equal(P.pick('sail'), true);                    // the second pick lands mid-switch
  assert.equal(P.plan, 'sail');
  P.landed('cruise');                                    // the Cruise switch finishes: it must not undo the pick
  assert.equal(P.plan, 'sail', 'the card still shows Sail');
  assert.equal(P.toStart(), 'sail', 'Enter asks for Sail');
  P.landed('sail');                                      // the queued Sail switch lands
  assert.equal(P.plan, 'sail'); assert.equal(P.toStart(), null); assert.equal(P.picking, false);
});

test('plan: a mode that lands on its own moves the plan; the attract switch (quiet) does not', () => {
  const P = createPlan('sail');
  P.landed('cruise');                                    // the top bar's Cruise
  assert.equal(P.plan, 'cruise');
  P.landed('sail', true); assert.equal(P.plan, 'cruise', 'quiet landing keeps the plan');
  assert.equal(P.toStart(), 'cruise');
  P.reset(); assert.equal(P.plan, 'sail');
});

test('tack pill: centred over the wheel, above it, kept inside the window', () => {
  const p = tackButtonPos({ x: 100, y: 600, w: 120, h: 120 }, 1280, 800);
  assert.deepEqual(p, { x: 112, y: 550 });
  const q = tackButtonPos({ x: 0, y: 10, w: 20, h: 20 }, 390, 844);
  assert.ok(q.x >= 4 && q.y >= 4);
  assert.equal(tackButtonPos(null, 1, 1), null);
});

test('Keys page touch text: look is two fingers, zoom is a pinch; hands are known words', () => {
  const rows = GROUPS.flatMap((g) => g.rows);
  const look = rows.find((r) => r.k?.[0] === 'drag'), zoom = rows.find((r) => r.k?.[0] === 'wheel');
  assert.match(look.a, /two fingers/); assert.match(zoom.a, /pinch/);
  assert.ok(HANDS.includes('pinch'));
});
