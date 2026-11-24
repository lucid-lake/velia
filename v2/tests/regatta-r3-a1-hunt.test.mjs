// Refactor round 3, A1 bug 1: a new race stops Tessie's hunt (Restart, Next race, a level change).
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
const sailTo = (R, f, maxS = 300) => { for (let s = 0; s < maxS && !f(); s += 2) R.settle(2); return f(); };

test('a new race stops Tessie\'s hunt: Restart mid-warning drops the chase and the drone cue', async () => {
  const st = { visible: false, centre: [0, 0], t: 0, phase: 'idle' }, log = [];
  const sim = { state: st, riseUnder: () => { st.visible = true; st.phase = 'swim'; }, hunt: (on) => log.push(`hunt:${on}`), swimTo: (x) => log.push(x == null ? 'swimTo:null' : 'swimTo'), play: () => {} };
  const { R } = engine({ tessie: { sim, raceCue: (v) => log.push(`cue:${v}`) } });
  await R.enter({ hub: true, deal: true });
  R.racePlace('tessies-deep');
  assert.ok(sailTo(R, () => log.includes('hunt:true')), 'she warns and hunts');
  log.length = 0;
  R.restart();
  assert.ok(log.includes('hunt:false'), `hunt stopped: ${log}`);
  assert.ok(log.includes('swimTo:null'), `swim target cleared: ${log}`);
  assert.ok(log.includes('cue:0'), `cue off: ${log}`);
});

