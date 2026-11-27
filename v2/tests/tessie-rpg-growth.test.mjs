// The Tessie RPG: level-ups that are felt. The Dash's ranks (speed, burst, cooldown) and her cruise's growth by level, measured on the
// real sim and controller, and set by the player from the save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlay } from '../sim/tessiePlay.js';
import { growthOf, GROWTH } from '../sim/tessieSkills.js';
import { createTessiePlayer } from '../living/tessiePlayer.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { BOUNTY, xpAt } from '../sim/tessieBounty.js';

const DT = 1 / 30;
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const make = () => { const depthAt = () => 40; const sim = createTessie({ seed: 3, depthAt }); const C = createTessiePlay({ sim, depthAt }); C.begin({ x: 0, z: 0, heading: 0 }); return { sim, C }; };
const run = (o, secs, hands, each = null) => { for (let i = 0; i < Math.round(secs / DT); i++) { o.sim.step(DT, { playing: true }); o.C.step(DT, typeof hands === 'function' ? hands(i * DT) : hands, {}); each?.(); } };
const hold = (o) => ({ move: [0, 1], sink: o.C.state.nose < 7.5, rise: o.C.state.nose > 9 });   // W, about 8 m down
const deep = (o) => { run(o, 8, { move: [0, 1], sink: true }); run(o, 3, () => hold(o)); };

// one burst under the water at rank r: her top speed and the metres the burst carries her past her cruise
function burst(rank, grow = 1) {
  const o = make(); if (rank) o.C.skills.rank('dash', rank); o.C.grow(grow); deep(o);
  const cruise = o.sim.state.nose.speed;
  let top = 0, d = 0, px = o.sim.state.nose.x, pz = o.sim.state.nose.z;
  run(o, 6, (t) => ({ ...hold(o), dash: t < DT }), () => { const n = o.sim.state.nose; top = Math.max(top, n.speed); d += Math.hypot(n.x - px, n.z - pz); px = n.x; pz = n.z; });
  return { cruise, top, gain: d - cruise * 6 };
}

test('each Dash rank is a felt jump: faster and longer under the water (rank 2 used to add 0.3 s and nothing else)', () => {
  const r = [1, 2, 3, 4].map((k) => burst(k));
  const plain = burst(0);
  assert.ok(Math.abs(plain.top - 19) < 0.3, `no rank set (the flag off): today's 19 m/s (${plain.top.toFixed(2)})`);
  assert.ok(Math.abs(r[0].top - 19) < 0.3, `rank 1: 19 m/s (${r[0].top.toFixed(2)})`);
  for (let k = 1; k < 4; k++) {
    assert.ok(r[k].top > r[k - 1].top + 1.5, `rank ${k + 1} tops rank ${k} by more than 1.5 m/s (${r[k - 1].top.toFixed(1)} → ${r[k].top.toFixed(1)})`);
    assert.ok(r[k].gain > r[k - 1].gain * 1.25, `rank ${k + 1}'s burst gains at least 25 % more ground over her cruise than rank ${k}'s (${r[k - 1].gain.toFixed(0)} → ${r[k].gain.toFixed(0)} m)`);
  }
  assert.ok(r[3].top < 25.5, `rank 4 stays an animal's burst (${r[3].top.toFixed(1)} m/s)`);
});

test('her body grows with her level: cruise + 1.5 % a level, capped at + 15 %; the player sets it from the save, flag off never', () => {
  assert.equal(growthOf(1), 1); assert.equal(+growthOf(5).toFixed(3), 1.06); assert.equal(+growthOf(11).toFixed(3), 1.15); assert.equal(growthOf(20), 1 + GROWTH.cruiseMax);
  const lo = burst(1, growthOf(1)), hi = burst(1, growthOf(11));
  assert.ok(Math.abs(lo.cruise - 11) < 0.2, `level 1 under the water: 11 m/s (${lo.cruise.toFixed(2)})`);
  assert.ok(Math.abs(hi.cruise - 12.65) < 0.25, `level 11: 12.65 m/s (${hi.cruise.toFixed(2)})`);
  // the player: a save at level 10 grows her; the flag off leaves her as she is
  const rig = (rpg, store) => {
    const wind = { pattern: null, base: { dirDeg: 225, speedMs: 5 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(5, 225)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
    const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
    const sim = createTessie({ seed: 1, depthAt: () => 40 });
    const P = createTessiePlayer({ plugin: { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 }, B, depthAt: () => 40, headless: true, veil: () => {}, storage: store, rpg, day: () => '2026-07-04' });
    const at = { x: B.state.x + 150, z: B.state.z + 100 }, bb = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 };
    sim.ambush(at.x, at.z, 0, 0.2); sim.hunt(false);
    for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: bb, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
    P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
    P.swap.step(DT, { on: true, shown: true, distM: 50 }); P.become('swap');
    for (let k = 0; k < 30; k++) { sim.step(DT, { playing: true, boat: bb, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } }); P.step(DT); }
    return P;
  };
  const save = JSON.stringify({ _v: 2, xp: xpAt(10), ranks: { dash: 1 } });
  assert.equal(+rig(true, memStore({ [BOUNTY.key]: save })).ctl.growK.toFixed(3), 1.135, 'level 10: × 1.135');
  assert.equal(rig(false, memStore({ [BOUNTY.key]: save })).ctl.growK, 1, 'the flag off: no growth');
});
