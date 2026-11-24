// Refactor round 3, A1 bug 2: a place race by URL with ?seed= is dealt from the seed, never from the calendar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createRegatta } from '../regatta/index.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function engine({ flags = {}, tessie = null } = {}) {
  const dir = 200;
  const wind = { pattern: null, base: { dirDeg: dir, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, dir)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', autoplay: '1', autotier: 'hard', ...flags }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store: mem(), persist: true,
    onSalute: () => true, tessie: () => tessie, glassBoat: () => null, onStorm: () => false, has: null, reduced: () => false });
  return { R, B };
}
test('a place race by URL with ?seed= deals the same on any day; no seed keeps the daily deal', async () => {
  const RealDate = globalThis.Date;
  const at = (iso) => { globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [iso])); } static now() { return new RealDate(iso).getTime(); } }; };
  const deal = async (iso, flags) => { at(iso); try { const { R } = engine({ flags: { course: 'tea-house-run', handseed: '', seed: '5', ...flags } }); await R.enter({}); return R.hand.raceSeed; } finally { globalThis.Date = RealDate; } };
  const a = await deal('2026-11-01T12:00:00', {}), b = await deal('2026-11-02T12:00:00', {});
  assert.equal(a, b, 'the same ?seed= deals the same race on two days');
  const c = await deal('2026-11-01T12:00:00', { seed: '6' });
  assert.notEqual(a, c, 'another seed deals another race');
  const d1 = await deal('2026-11-01T12:00:00', { seed: 'x' }), d2 = await deal('2026-11-02T12:00:00', { seed: 'x' });
  assert.notEqual(d1, d2, 'no seed given: the daily deal changes with the day');
});
