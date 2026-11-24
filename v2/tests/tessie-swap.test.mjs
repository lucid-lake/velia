// Play as Tessie, phase 1d (§ 3.6, § 4.3): the swap's state and the pill's rules; the skipper's flee. Behaviour only.
//   the pill: shows when she shows herself within 300 m, stays 5 s after she goes, at once in her revenge; never in a race, knocked
//   down, with a card open, on a phone (playTessie off) or while you are her
//   the swap: one state; T in, T back; the chart's entry needs no sighting, the swap does
//   the flee: a broad reach on the side away from her, never into the wind's no-go cone, a heading clear of shoal water
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwap, SWAP } from '../sim/tessieSwap.js';
import { fleeHeading, createFlee, FLEE } from '../sim/tessieFlee.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';

const DEG = Math.PI / 180;
const base = { on: true, mode: 'sail', race: false, knocked: false, card: false, shown: false, distM: Infinity, revenge: false };

test('the pill: shown herself within 300 m, 5 s after, at once in her revenge; never in a race, knocked down, a card open or off', () => {
  const W = createSwap();
  assert.equal(W.step(0.1, base).pill, false, 'not seen');
  assert.equal(W.step(0.1, { ...base, shown: true, distM: 350 }).pill, false, 'too far');
  assert.equal(W.step(0.1, { ...base, shown: true, distM: 200 }).pill, true, 'she shows herself');
  for (let i = 0; i < 45; i++) W.step(0.1, base);
  assert.equal(W.pill, true, 'still, 4.5 s after');
  for (let i = 0; i < 10; i++) W.step(0.1, base);
  assert.equal(W.pill, false, 'gone after 5 s');
  assert.equal(W.step(0.1, { ...base, revenge: true }).pill, true, 'her revenge: at once');
  for (const k of [{ race: true }, { mode: 'regatta' }, { knocked: true }, { card: true }, { on: false }]) assert.equal(createSwap().step(0.1, { ...base, shown: true, distM: 50, ...k }).pill, false, JSON.stringify(k));
  assert.equal(createSwap().step(0.1, { ...base, mode: 'cruise', shown: true, distM: 50 }).pill, true, 'Cruise too');
  assert.equal(SWAP.showM, 300);
});

test('the swap: one state; the swap needs the pill, the chart and the menu do not; never in a race or knocked down', () => {
  const W = createSwap();
  assert.equal(W.can('swap', base), 'unseen');
  assert.equal(W.can('chart', base), null);
  assert.equal(W.can('menu', { ...base, race: true }), 'race');
  assert.equal(W.can('chart', { ...base, knocked: true }), 'knocked');
  assert.equal(W.can('swap', { ...base, on: false }), 'off');
  W.step(0.1, { ...base, shown: true, distM: 40 });
  assert.equal(W.can('swap', base), null);
  assert.deepEqual(W.become('swap'), { as: 'tessie', entry: 'swap', from: 'boat' });
  assert.equal(W.as, 'tessie'); assert.equal(W.become('swap'), null, 'already her');
  assert.equal(W.step(0.1, { ...base, shown: true, distM: 10 }).pill, false, 'no pill while you are her');
  assert.deepEqual(W.back(), { as: 'boat', entry: null, from: 'swap' });
  assert.equal(W.back(), null); assert.equal(W.count, 1);
});

test('the flee: a broad reach away from her, out of the no-go cone, clear of shoal water', () => {
  const s = { x: 0, z: 0, heading: 0 }, windFrom = 0;   // the wind from the north
  const h = fleeHeading(s, windFrom, { x: 50, z: 0 }, () => true);
  assert.ok(Math.abs(Math.abs(h) - FLEE.twaDeg * DEG) < 1e-6, `${(h / DEG).toFixed(0)}°`);
  assert.ok(h < 0, 'away from her (she is to the east): the western reach');
  assert.ok(fleeHeading(s, windFrom, { x: -50, z: 0 }, () => true) > 0);
  const h2 = fleeHeading(s, windFrom, { x: 50, z: 0 }, (x) => x > 0);   // the west is shoal: the other reach
  assert.ok(h2 > 0 && Math.abs(h2 - windFrom) >= 50 * DEG);
  // on the real boat: the skipper's drive bears her away and holds the reach
  const B = createBoatSim({ water: waterFor(() => 0), wind: { sample: steadyWind(6, 0) }, start: { x: 0, z: 0, headingDeg: 300, speed: 2.5 } });
  const F = createFlee({ B, depthAt: () => 40, her: () => ({ x: 40, z: 0 }) });
  B.drive(F.drive);
  for (let i = 0; i < 60 * 40; i++) B.step(1 / 60);
  const twa = Math.abs(B.state.trueWind.angle) / DEG;
  assert.ok(twa > 110 && twa < 150, `on a broad reach (TWA ${twa.toFixed(0)}°)`);
  assert.ok(B.state.x < -40, `away from her (${B.state.x.toFixed(0)} m)`);
});
