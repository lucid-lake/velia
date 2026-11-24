// The pro trim panel (src/stations/sloop/trimPanel.js): the hardware, the frames follow the values, a step is a tenth, the drag maps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIM, STEP, frameOfValue, valueAtX, stepValue } from '../src/stations/sloop/trimPanel.js';
import { helmLayout, overlaps } from '../classic/src/stations/sloop/helmStation.js';

const T = Object.fromEntries(TRIM.map((t) => [t.id, t]));
test('traveller and jib lead are cars on tracks; twist and backstay knobs; wing a toggle', () => {
  assert.equal(T.traveller.kind, 'track'); assert.equal(T.jibLead.kind, 'track');
  assert.equal(T.twist.kind, 'knob'); assert.equal(T.backstay.kind, 'knob'); assert.equal(T.wing.kind, 'toggle'); assert.equal(T.vhf.kind, 'push');
  assert.deepEqual([T.backstay.lo, T.backstay.hi], [0, 1]);
});
test('the frames follow the values, ends included; null is the middle', () => {
  assert.equal(frameOfValue(T.traveller, -1), 0); assert.equal(frameOfValue(T.traveller, 1), 10); assert.equal(frameOfValue(T.traveller, null), 5);
  assert.equal(frameOfValue(T.backstay, 0), 0); assert.equal(frameOfValue(T.backstay, 1), 12); assert.equal(frameOfValue(T.twist, 0), 6);
});
test('a step is a tenth of the range, clamped; the drag maps across the travel', () => {
  assert.equal(stepValue(T.traveller, 0, 1), STEP); assert.equal(stepValue(T.traveller, 1, 1), 1); assert.equal(stepValue(T.backstay, 0, -1), 0);
  assert.equal(valueAtX(T.jibLead, 0), -1); assert.equal(valueAtX(T.jibLead, 1), 1); assert.equal(valueAtX(T.jibLead, 0.5), 0);
});
test('the layout: on top of the control panel, right-aligned, clear of the group and inside the screen at 1280 × 720', () => {
  const L = helmLayout({ w: 1280, h: 720, d: 220, by: 14, mx: 40 });
  assert.ok(L.trim.y + L.trim.h <= L.panel.y && L.trim.x + L.trim.w === L.panel.x + L.panel.w);
  for (const k of ['wheel', 'jib', 'main', 'panel']) assert.ok(!overlaps(L.trim, L[k]), k);
});
