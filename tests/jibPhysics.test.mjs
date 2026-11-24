// Does the jib work physically (owner, 2026-10-30)? The player's jib sheet (CONTROLS.jibTrim: the JIB winch, R / F) on a
// steady close-hauled course and a beam reach in 12 kn (the crew trims the main, a pilot holds the true wind angle):
// eased it luffs and the boat slows and stands up; trimmed right it is fastest; hauled past the lead it stalls and slows.
// On the beam reach the crew's stop (the rail) leaves the jib stalled: eased past it (JIB_HAND) the boat goes faster.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, Helm, steadyWind, CONTROLS, KN, DT, BOAT, jibHandRange } from '../src/sim/boat.js';

const DEG = Math.PI / 180;
function trial(twaDeg, trimDeg) {
  const env = { windAt: steadyWind(12 * KN, 0), t: 0 };
  const b = new BoatPhysics({ heading: -twaDeg * DEG, speed: 5 * KN }), helm = new Helm();
  const m = { kn: 0, heel: 0, rudder: 0, fill: 0, stall: 0, jib: 0, match: 0, n: 0 };
  for (let i = 0; i < 80 / DT; i++) {
    env.t += DT;
    b.step(DT, { ...CONTROLS, jibTrim: trimDeg * DEG, rudder: helm.toTWA(b.state, -twaDeg * DEG, 0) }, env);
    if (i * DT > 55) { const s = b.state; m.kn += s.u / KN; m.heel += Math.abs(s.heel) / DEG; m.rudder += s.rudderAngle / DEG; m.fill += s.jibFill; m.stall += s.jibStall; m.jib += s.jibSheet / DEG; m.match += s.jibMatch / DEG; m.n++; }
  }
  for (const k of Object.keys(m)) if (k !== 'n') m[k] /= m.n;
  return m;
}

test('close-hauled (TWA 45°, 12 kn): eased the jib luffs and the boat slows; trimmed it is fastest; hauled past the lead it stalls', () => {
  const over = trial(45, -18), best = trial(45, -8), crew = trial(45, 0), eased = trial(45, 12);
  assert.ok(eased.fill < 0.3 && eased.kn < best.kn - 1, `eased: fill ${eased.fill.toFixed(2)}, ${eased.kn.toFixed(2)} vs ${best.kn.toFixed(2)} kn`);
  assert.ok(eased.heel < best.heel - 6, 'eased, she stands up');
  assert.ok(over.stall > 0.8 && over.kn < best.kn - 0.1, `over-trimmed: stall ${over.stall.toFixed(2)}, ${over.kn.toFixed(2)} kn`);
  assert.ok(best.kn >= crew.kn, 'the player can beat the crew\'s stop');
  assert.ok(Math.abs(crew.jib - crew.match) < 1e-6, 'no hand on it: the crew\'s own trim, unchanged');
});

test('beam reach (TWA 90°, 12 kn): the crew\'s stop leaves the jib stalled; eased past the rail it draws and she goes faster; hauled in, slower', () => {
  const hauled = trial(90, -14), crew = trial(90, 0), eased = trial(90, 12);
  assert.ok(crew.stall > 0.8, 'at the rail the jib is stalled');
  assert.ok(eased.stall < 0.3 && eased.kn > crew.kn + 0.15, `eased: stall ${eased.stall.toFixed(2)}, ${eased.kn.toFixed(2)} vs ${crew.kn.toFixed(2)} kn`);
  assert.ok(hauled.kn < crew.kn, 'hauled in: slower');
  assert.ok(eased.rudder !== crew.rudder && eased.heel !== crew.heel, 'the helm and the heel answer the jib');
});

test('the hand\'s range: past the lead and past the rail', () => {
  const [lo, hi] = jibHandRange(BOAT);
  assert.ok(lo < BOAT.jib.lead && hi > BOAT.jib.maxDeg * DEG);
});
