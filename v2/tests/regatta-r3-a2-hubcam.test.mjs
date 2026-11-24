// Refactor round 3, A2 bug 9: the hub's camera ease starts from the new hub's frame, not the last visit's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createRegatta } from '../regatta/index.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const base = () => ({ pos: [0, 5, 0], target: [0, 0, -10], fov: 60 });

test('reopening the hub cuts to its frame: no drift from the previous visit\'s bay', async () => {
  const wind = { pattern: null, base: { dirDeg: 210, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 210)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7' }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store: mem(), persist: true });
  await R.enter({ hub: true, deal: true });
  const a = R.selected, b = a === 'tea-house-run' ? 'pass-the-channel' : 'tea-house-run';
  R.select(b);
  for (let i = 0; i < 5; i++) R.camera(1 / 30, base());   // the hub's eased frame sits on b's bay
  R.go();                                                // she sails away (no hub camera frames run)
  R.openHub(); R.select(a);                             // the hub again, on the other bay
  R.camera(1 / 30, base());
  assert.ok(R.stats.hubCam.lag < 0.5, `the first frame lags ${R.stats.hubCam.lag} m behind the hub's frame`);
});
