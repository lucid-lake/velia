// The Tessie RPG's pacing and fairness (?tessierpg=1), measured as a player feels them, on the real sims: she plays with the chase
// pin (W toward a boat, Space once locked), the way tools/v2-perf.mjs's evidence does.
//   camping one boat: the Halcyon knocked again every 46 s paid more than roaming (6 XP a knock); now the same boat within 120 s pays
//     half a time (v2/sim/tessieBounty.js repeatS), and the skipper's line says why once
import test from 'node:test';
import assert from 'node:assert/strict';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlayer, REPEAT_LINE } from '../living/tessiePlayer.js';

const DT = 1 / 30, deep = () => 40, KN = 0.514444;
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// her on open water 180 m off the Halcyon (the skipper sails away from her), no other boat
function halcyonRig() {
  const ms = 15 * KN, wind = { pattern: null, base: { dirDeg: 225, speedMs: ms }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(ms, 225)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage: memStore(), rpg: true, day: () => '2026-07-04' });
  const at = { x: B.state.x + 150, z: B.state.z + 100 }, bb = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 };
  sim.ambush(at.x, at.z, 0, 0.2); sim.hunt(false);
  const view = () => { const n = sim.state.nose; return { x: n?.x ?? at.x, z: (n?.z ?? at.z) + 40, yaw: 0, hHalf: 0.6 }; };
  for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: bb, view: view() });
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  assert.ok(P.become('swap').ok);
  const step = (secs) => { for (let k = 0; k < Math.round(secs / DT); k++) { sim.step(DT, { playing: true, boat: bb, view: view() }); P.step(DT); } };
  return { P, sim, B, step };
}

test('camping the Halcyon: the second knock within 120 s pays half, the third a quarter, and the reason is said once', () => {
  const { P, step } = halcyonRig();
  P.pin({ nose: 0.75, chase: 'halcyon' });
  step(200);
  const rows = P.stats().log.bounty.filter((r) => r.kind === 'halcyon');
  assert.ok(rows.length >= 3, `three knocks on the Halcyon in 200 s (${JSON.stringify(rows)})`);
  assert.equal(rows[0].xp, 18, 'the first: 4 × 1.5 seen × 3 first');
  assert.equal(rows[1].xp, 3, 'the second, 46 s later: 6 halved');
  assert.equal(rows[1].repeat, 1);
  assert.equal(rows[2].xp, 2, 'the third: a quarter (1.5, rounded)');
  assert.ok(P.stats().tipsWant.includes(REPEAT_LINE.kind), 'the skipper\'s line will say why (once ever)');
});
