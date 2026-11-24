// R/F trim the jib (owner, 2026-11-16: "W/S I can clearly see the mainsail change; R/F I don't see anything"): in v2, basic and
// Pro alike, R pulls the jib's own sheet in and F eases it (v1's Pro made them the jib lead, a few cm of cloth); the desk's
// held jib winch runs at its faster rates; the drawn clew moves by a visible amount at 15 kn; the key legend reads R/F as the
// jib sheet in v2's Pro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor, KN, DESK_TRIM } from '../sim/boat.js';
import { keysToTrim } from '../sim/controls.js';
import { steadyWind } from '../../src/sim/boat.js';
import { sailParams, jibPoint } from '../../src/boat/rig.js';
import { drawnPose } from '../render/boat/drawnTrim.js';
import { lineOf, assembleLines } from '../../src/ui/keyLegend.js';

const DEG = Math.PI / 180, DT = 1 / 60;
const steady = (ms, d) => ({ sample: (x, z, t) => { const v = steadyWind(ms, d)(x, z, t); return { vx: v.vx, vz: v.vz }; } });
const K = (...c) => keysToTrim(new Set(c));
function boat(pro, trim = DESK_TRIM) {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(15 * KN, 200), trim });
  B.settle(15); B.pro = pro;
  for (let i = 0; i < 30; i++) B.step(DT, { steer: 0, pull: 0 });
  return B;
}
const hold = (B, s, trim) => { for (let i = 0; i < Math.round(s / DT); i++) B.step(DT, { steer: 0, pull: 0, trim }); };
const clew = (B) => jibPoint(1, 0, sailParams(drawnPose(B.pose)).jib);
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

for (const pro of [false, true]) test(`${pro ? 'Pro' : 'basic'}: R pulls the jib sheet in, F eases it; the drawn clew moves more than 30 cm each way at 15 kn`, () => {
  const B = boat(pro);
  const s0 = B.state.jibSheet, c0 = clew(B);
  hold(B, 1, K('KeyF'));
  const s1 = B.state.jibSheet, c1 = clew(B);
  assert.ok(s1 > s0 + 10 * DEG, `F eases: ${(s0 / DEG).toFixed(1)}° → ${(s1 / DEG).toFixed(1)}°`);
  assert.ok(d(c0, c1) > 0.3, `the drawn clew out ${(d(c0, c1) * 100).toFixed(0)} cm`);
  hold(B, 2, K('KeyR'));
  const s2 = B.state.jibSheet, c2 = clew(B);
  assert.ok(s2 < s0 - 10 * DEG, `R pulls in: ${(s2 / DEG).toFixed(1)}°`);
  assert.ok(d(c0, c2) > 0.3, `the drawn clew in ${(d(c0, c2) * 100).toFixed(0)} cm`);
  if (pro) assert.equal(B.ctl.jibLead, null, 'the lead untouched by R/F');
});

test('the desk\'s held jib winch: faster than v1\'s (a phone keeps v1\'s)', () => {
  const run = (trim) => { const B = boat(false, trim); const j0 = B.ctl.jibTrim ?? 0; hold(B, 0.4, K('KeyR')); return (j0 - B.ctl.jibTrim) / DEG; };   // R: F stops 16° past the crew's match (the hand's range)
  const desk = run(DESK_TRIM), phone = run(null);
  assert.ok(desk > phone * 1.25, `0.4 s of R: desk ${desk.toFixed(1)}°, phone ${phone.toFixed(1)}°`);
});

test('the legend in v2\'s Pro: R/F the jib sheet, no jib-lead line; v1\'s modes unchanged', () => {
  assert.equal(lineOf('KeyR', false, 'pro-sheet'), 'jib');
  assert.equal(lineOf('KeyR', false, 'pro-basic'), 'lead', 'v1\'s Pro');
  const ids = assembleLines('pro-sheet').lines?.map((l) => l.id) ?? assembleLines('pro-sheet').map((l) => l.id);
  assert.ok(ids.includes('jib') && !ids.includes('lead'), JSON.stringify(ids));
});
