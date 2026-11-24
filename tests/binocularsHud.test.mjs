// The binoculars' instruments (src/ui/binocularsHud.js): the bearing, the rangefinder's ray, the compass scale's marks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearingOf, rangeTo, compassTicks, fmtRange } from '../src/ui/binocularsHud.js';

test('the true bearing: north is −z, east is +x, clockwise', () => {
  assert.equal(Math.round(bearingOf(0, -1)), 0); assert.equal(Math.round(bearingOf(1, 0)), 90);
  assert.equal(Math.round(bearingOf(0, 1)), 180); assert.equal(Math.round(bearingOf(-1, 0)), 270);
});

test('the rangefinder: the water under a falling ray, a hill in front, nothing looking up', () => {
  const d = { x: 0, y: -Math.sin(Math.atan2(2, 400)), z: -Math.cos(Math.atan2(2, 400)) };
  const r = rangeTo({ x: 0, y: 2, z: 0 }, d, () => -10);
  assert.ok(Math.abs(r - Math.hypot(2, 400)) < 2, `water at ${r}`);
  const hill = rangeTo({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: -1 }, (x, z) => (z < -1240 ? 50 : -10));
  assert.ok(Math.abs(hill - 1240) < 2, `hill at ${hill}`);
  assert.equal(rangeTo({ x: 0, y: 2, z: 0 }, { x: 0, y: 0.5, z: -0.87 }, () => -10), null);
  assert.equal(fmtRange(1240.4), '1,240 m'); assert.equal(fmtRange(null), '– – – m');
});

test('the compass scale: ticks every 5°, numbers every 10° with three digits, wrapping through north', () => {
  const t = compassTicks(3);
  assert.ok(t.every((m) => m.deg % 5 === 0));
  assert.deepEqual(t.filter((m) => m.label).map((m) => m.label), ['350', '000', '010', '020']);
  assert.ok(t.some((m) => m.deg === 355 && !m.major));
});
