// The drawn trim (v2/render/boat/drawnTrim.js; owner, 2026-11-16): the drawn boom follows the sheet across its whole range
// (eased past the luff, the physics' boom stops at the sail's free angle; the drawing takes 0.6 of the slack), it never
// jumps sides near the centreline, a drawn sheet is never past the boom's stop; the Pro shape changes are drawn 3 × (the
// twist, the jib lead's foot), a Pro backstay's flattening 3 × down to a floor; basic descriptors and the physics untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor, KN, DESK_TRIM } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { sailParams } from '../../src/boat/rig.js';
import { DRAWN, drawnPose, drawnSail, followAngle } from '../render/boat/drawnTrim.js';

const DEG = Math.PI / 180;
const steady = (ms, d) => ({ sample: (x, z, t) => { const v = steadyWind(ms, d)(x, z, t); return { vx: v.vx, vz: v.vz }; } });

test('a full trim at 15 kn: the drawn boom comes in with the sheet over the whole range; the physics\' boom is still for most of it', () => {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(15 * KN, 200), trim: DESK_TRIM });
  B.settle(15);
  let n = 0;
  while ((B.ctl.sheet ?? 0) < 79 * DEG && n++ < 600) B.step(1 / 60, { steer: 0, pull: -1 });
  for (let i = 0; i < 60; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  const rows = []; n = 0;
  while (B.ctl.sheet > 13 * DEG && n++ < 600) {
    B.step(1 / 60, { steer: 0, pull: 1 });
    const phys = Math.abs(B.pose.boomAngle), physState = Math.abs(B.state.boomAngle), drawn = Math.abs(drawnPose(B.pose).boomAngle);
    assert.equal(phys, physState, 'the physics untouched');
    rows.push({ sheet: B.ctl.sheet, phys, drawn });
  }
  const first = rows[0], last = rows.at(-1);
  // the physics: the boom barely moves while the sheet comes in from 79° to 35°
  const eased = rows.filter((r) => r.sheet > 35 * DEG);
  assert.ok(Math.abs(eased[0].phys - eased.at(-1).phys) < 3 * DEG, `the physics' boom ${(eased[0].phys / DEG).toFixed(1)}° → ${(eased.at(-1).phys / DEG).toFixed(1)}°`);
  // the drawing: over the same span the boom comes in by more than 15°, never going out while the sheet comes in
  assert.ok(eased[0].drawn - eased.at(-1).drawn > 15 * DEG, `the drawn boom ${(eased[0].drawn / DEG).toFixed(1)}° → ${(eased.at(-1).drawn / DEG).toFixed(1)}°`);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].drawn <= rows[i - 1].drawn + 0.2 * DEG, `monotonic at ${(rows[i].sheet / DEG).toFixed(1)}°`);
  // trimmed: the drawing is the physics' boom
  assert.ok(Math.abs(last.drawn - last.phys) < 0.3 * DEG, 'trimmed in: drawn = physics');
  assert.ok(first.drawn > first.phys + 15 * DEG && first.drawn <= DRAWN.MAIN_MAX * DEG, `fully eased: out past the luff (${(first.drawn / DEG).toFixed(1)}°)`);
});

test('the follow: 0.6 of the slack, none near the centreline (no jump on a tack), capped at the stop, the side kept', () => {
  const s = 70 * DEG;
  assert.ok(Math.abs(followAngle(30 * DEG, s, 8, 72) - (30 + 0.6 * (70 - 8 - 30)) * DEG) < 1e-9);
  assert.ok(Math.abs(followAngle(-30 * DEG, s, 8, 72) + (30 + 0.6 * 32) * DEG) < 1e-9, 'port side');
  assert.equal(followAngle(1 * DEG, s, 8, 72), 1 * DEG, 'at the centreline: no follow');
  for (let a = -12; a <= 12; a += 0.25) {   // crossing the centreline: continuous
    const d0 = followAngle(a * DEG, s, 8, 72), d1 = followAngle((a + 0.25) * DEG, s, 8, 72);
    assert.ok(Math.abs(d1 - d0) < 5 * DEG, `no jump at ${a}°`);
  }
  assert.ok(followAngle(70 * DEG, 80 * DEG, 8, 72) <= 72 * DEG);
  assert.equal(followAngle(20 * DEG, null, 8, 72), 20 * DEG, 'no sheet: as is');
  const p = { boomAngle: 0.3, jibAngle: 0.2, mainSheet: 1.2, jibSheet: 1.0, jibBacked: true };
  assert.equal(drawnPose(p).jibAngle, 0.2, 'a backed jib drawn as it is');
  assert.equal(p.boomAngle, 0.3, 'the input pose untouched');
});

test('the Pro shape drawn 3 ×: the vang\'s and the lead\'s twist, the lead\'s foot, a Pro backstay\'s flattening (floored); basic unchanged', () => {
  const sp = { main: { twistX: 4, draft: 0.8 }, jib: { twistX: 5, lead: 0.5, draft: 0.8 } };
  const d = drawnSail(sp, 0.4);
  assert.equal(d.main.twistX, 12); assert.equal(d.jib.twistX, 15); assert.equal(d.jib.lead, 1.5);
  assert.ok(Math.abs(d.main.draft - 0.4) < 1e-9 && Math.abs(d.jib.draft - 0.4) < 1e-9, `draft 0.8 → ${d.main.draft}`);
  assert.equal(drawnSail({ main: { draft: 0.5 }, jib: { draft: 0.5 } }, 1).main.draft, DRAWN.draftMin, 'full backstay: the floor');
  assert.equal(sp.main.twistX, 4, 'the input untouched');
  // a basic sail (no Pro controls, the crew's flattening): the same descriptor
  const basic = sailParams({ boomAngle: 0.2, jibAngle: 0.15, mainFill: 1, jibFill: 1, mainDraft: 0.7, jibDraft: 0.7 });
  assert.deepEqual(drawnSail(basic, null), { main: { ...basic.main }, jib: { ...basic.jib } });
  assert.deepEqual([DRAWN.twist, DRAWN.lead, DRAWN.draft], [3, 3, 3]);
});
