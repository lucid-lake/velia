// The two dials as 2D modules (v2/ui/dials.js) and the wind dial's new reads. No browser (the browser half:
// v2/tests/pages/dialModules.page.mjs):
//   the mode table   the dials key: on in Sail and Regatta, off in Cruise; every row says it
//   the show rules   Calm dims after its idle and never hides; Clear, a played Tessie and a mode without dials hide; Full never dims
//   the luff angle   luffAwaDeg: the jib's chord at its lead + the angle it fills at + the leeway; the sim's jib draws fully there
//   point of sail    the bands from the true wind, both tacks, and the 3° hysteresis at each edge
import test from 'node:test';
import assert from 'node:assert/strict';
import { modeRows, showsDials } from '../engine/modes.js';
import { dialModuleState, DIAL_MODULES } from '../ui/dials.js';
import { luffAwaDeg, BOAT, steadyState } from '../../src/sim/boat.js';
import { pointOfSail, pointLabel, POINTS, HYST } from '../../src/ui/pointOfSail.js';

const DEG = Math.PI / 180;

test('the mode table: the dials show in Sail and Regatta, not in Cruise; every row says', () => {
  assert.equal(showsDials('sail'), true);
  assert.equal(showsDials('regatta'), true);
  assert.equal(showsDials('cruise'), false);
  assert.equal(showsDials('nope'), false);
  for (const r of modeRows()) assert.equal(typeof r.dials, 'boolean', `row ${r.id} has a dials key`);
});

test('the show rules: Calm dims after its idle, never hides; Clear, Tessie and a mode without dials hide', () => {
  for (const preset of ['calm', 'auto']) {
    assert.deepEqual(dialModuleState({ preset, dash: true }), { off: false, dim: false }, `${preset}: awake, full`);
    assert.deepEqual(dialModuleState({ preset, dash: false }), { off: false, dim: true }, `${preset}: idle, dimmed, shown`);
  }
  assert.deepEqual(dialModuleState({ preset: 'full', dash: true }), { off: false, dim: false });
  assert.deepEqual(dialModuleState({ preset: 'instruments', dash: false }), { off: false, dim: false });
  assert.equal(dialModuleState({ preset: 'clear', dash: false }).off, true);
  assert.equal(dialModuleState({ preset: 'calm', played: true }).off, true);
  assert.equal(dialModuleState({ preset: 'full', inMode: false }).off, true);
  assert.equal(dialModuleState({ preset: 'calm', dash: false, inMode: false }).dim, false, 'hidden is not dimmed');
  assert.ok(DIAL_MODULES.k === 0.8 && DIAL_MODULES.dim > 0 && DIAL_MODULES.dim < 1, 'the hover size and a visible dim');
});

test('luffAwaDeg: the jib at its lead + LUFF1 (25°) + the leeway; the steady sim\'s jib fills from there', () => {
  assert.equal(luffAwaDeg(BOAT), (BOAT.jib.lead + 4 * DEG) / DEG);
  assert.equal(Math.round(luffAwaDeg(BOAT)), 25);
  assert.equal(luffAwaDeg(BOAT, -2 * DEG), luffAwaDeg(BOAT) + 2, 'leeway either side widens it');
  // the sim: close-hauled in 12 kn the jib is full from about the angle (its own leeway on top)
  const near = steadyState({ twsKn: 12, twaDeg: 40 }), pinched = steadyState({ twsKn: 12, twaDeg: 32 });
  const at = luffAwaDeg(BOAT, near.leewayDeg * DEG);
  assert.ok(near.state.jibFill > 0.95 && near.awaDeg >= at - 1.5, `full at AWA ${near.awaDeg.toFixed(1)}° (luff ${at.toFixed(1)}°)`);
  assert.ok(pinched.state.jibFill < 0.9 && pinched.awaDeg < at, `luffing at AWA ${pinched.awaDeg.toFixed(1)}° (luff ${at.toFixed(1)}°)`);
});

test('point of sail: the bands from the true wind, either tack', () => {
  const at = (a) => pointLabel(pointOfSail(a));
  assert.deepEqual([0, 39, 41, 54, 56, 79, 81, 99, 101, 149, 151, 180].map(at),
    ['In irons', 'In irons', 'Close-hauled', 'Close-hauled', 'Close reach', 'Close reach', 'Beam reach', 'Beam reach', 'Broad reach', 'Broad reach', 'Running', 'Running']);
  assert.equal(at(-90), 'Beam reach');
  assert.equal(at(-170), 'Running');
  assert.equal(POINTS.length, 6);
});

test('point of sail: 3° of hysteresis at every edge, so a boat on a boundary keeps one word', () => {
  assert.equal(HYST, 3);
  for (let i = 1; i < POINTS.length; i++) {
    const lo = POINTS[i - 1], hi = POINTS[i], edge = hi.from;
    assert.equal(pointOfSail(edge + HYST - 0.1, lo.id), lo.id, `${lo.id} holds to ${edge + HYST}°`);
    assert.equal(pointOfSail(edge + HYST + 0.1, lo.id), hi.id, `${hi.id} past ${edge + HYST}°`);
    assert.equal(pointOfSail(edge - HYST + 0.1, hi.id), hi.id, `${hi.id} holds down to ${edge - HYST}°`);
    assert.equal(pointOfSail(edge - HYST - 0.1, hi.id), lo.id, `${lo.id} below ${edge - HYST}°`);
  }
  // a wobble of ±2° about 80° never flips the word
  let id = pointOfSail(81), flips = 0;
  for (let k = 0; k < 200; k++) { const n = pointOfSail(80 + 2 * Math.sin(k), id); if (n !== id) flips++; id = n; }
  assert.equal(flips, 0);
});
