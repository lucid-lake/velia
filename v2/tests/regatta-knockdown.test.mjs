// K3 in Regatta (owner 2026-11-17: "Regatta = DNF for that race"): knocked down, the race's own results card says
// DNF with the knockdown's line and tip, the Cup scores it as a DNF and goes on to its next race.
import test from 'node:test';
import assert from 'node:assert/strict';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createRegatta } from '../regatta/index.js';
import { newCup, saveCup, loadCup } from '../regatta/cup.js';
import { DEFAULT_SETUP } from '../regatta/setup.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

test('a knockdown in a Cup race: the results card says DNF, the Cup scores it and goes on', async () => {
  const store = memStore();
  saveCup(store, newCup(5, { ...DEFAULT_SETUP, skill: 'easy', aids: 'beginner' }));
  const wind = { pattern: null, base: { dirDeg: 210, speedMs: 6 }, levelSet: [], setLevel(n) { this.level = n; return 1; }, sample(x, z, t) { const v = steadyWind(6, 210)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', autoplay: '1' }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store, persist: true, sky: () => {} });
  await R.enter({ hub: true, deal: true });
  R.cupGo();
  R.settle(70);   // past the gun, racing
  assert.equal(R.stats.result, null);
  assert.equal(R.knockdown({ line: 'A 31 kn gust on the beam, full sail, sheets in', tip: 'Reef early, or ease the main in the gusts.' }), true);
  R.settle(1);
  const res = R.stats.result;
  assert.ok(res, 'the results card'); assert.equal(res.title, 'Knocked down · DNF'); assert.equal(res.gap, 'A 31 kn gust on the beam, full sail, sheets in');
  assert.equal(res.tip, 'knockdown');
  const cup = loadCup(store);
  assert.equal(cup.results.length, 1); assert.equal(cup.results[0].me, null, 'scored as a DNF');
  assert.equal(res.cup.done, false, 'the Cup goes on');
  R.cupNext();
  assert.equal(R.knocked, false, 'the next race is clean'); assert.equal(R.stats.result, null); assert.equal(R.hand.cup.i, 1);
});
