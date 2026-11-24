// audit W4: the gust's payoff on v2 (v2/sim/gust.js) is v1's (src/gustFx.js createGustFx): over a gust's trace the onsets,
// the snap events, the rush and the camera's lean match v1's frame for frame; a steady wind never fires; off is inert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGust } from '../sim/gust.js';
import { createGustFx, GUSTFX } from '../../src/gustFx.js';

// the true wind at the boat: 5 m/s, a gust to 6.4 m/s rising over 1 s at t = 30 s, held 8 s, easing off; a heel with it
const tws = (t) => 5 + 1.4 * Math.min(1, Math.max(0, (t - 30) / 1)) * Math.min(1, Math.max(0, (40 - t) / 3));
const stateAt = (t) => ({ trueWind: { speed: tws(t) }, u: 3, heel: 0.15 + 0.1 * Math.max(0, tws(t) - 5), heading: 0.4 });

test('the onset, the snap, the rush and the lean are v1\'s, frame for frame', () => {
  const v1 = createGustFx({ on: true, reduced: () => false, steady: () => true }), v2 = createGust({ on: true });
  const dt = 1 / 60;
  let onsets = 0;
  for (let i = 0; i < 60 * 60; i++) {
    const t = i * dt, s = stateAt(t);
    const a = v1.update(dt, s), b = v2.update(dt, s);
    assert.equal(!!b.onset, !!a.onset, `onset at ${t.toFixed(2)} s`);
    if (a.onset) { onsets++; assert.equal(b.onset.strength, a.onset.strength); assert.deepEqual(b.events, a.events); }
    assert.equal(b.rushMul, a.rushMul); assert.equal(b.spray, a.spray); assert.equal(b.punch, a.punch);
    const pose = () => ({ pos: [0, 3, 10], target: [2, 1, -5], fov: 50 });
    const pa = v1.lean(dt, pose(), s), pb = v2.lean(dt, pose(), s);
    const ua = pa.up ?? [0, 1, 0];
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(pb.up[k] - ua[k]) < 1e-12, `the lean's up at ${t.toFixed(2)} s`);
  }
  assert.equal(onsets, 1, 'one gust, one onset');
  assert.ok(v2.stats.onsets === 1 && v2.stats.last.strength > 0.5, `a strong landing (${v2.stats.last?.strength})`);
});

test('a steady wind never fires; off is inert; the snap is the main and the jib a beat after', () => {
  const g = createGust({ on: true });
  for (let i = 0; i < 3600; i++) assert.equal(g.update(1 / 60, { trueWind: { speed: 6 }, u: 3 }).onset, null);
  const off = createGust({ on: false });
  const r = off.update(1 / 60, stateAt(31));
  assert.equal(r.rushMul, 1); assert.equal(r.events.length, 0);
  const pose = { pos: [0, 3, 10], target: [0, 1, 0] };
  assert.equal(off.lean(1 / 60, pose, stateAt(31)).up, undefined);
  const on = createGust({ on: true });
  let ev = null;
  for (let i = 0; i < 60 * 40 && !ev; i++) { const x = on.update(1 / 60, stateAt(i / 60)); if (x.onset) ev = x.events; }
  assert.deepEqual(ev.map((e) => e.sail), ['main', 'jib']);
  assert.equal(ev[1].delay, GUSTFX.jibDelayS);
});
