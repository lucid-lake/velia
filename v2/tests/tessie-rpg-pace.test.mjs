// The Tessie RPG's pacing and fairness (?tessierpg=1), measured as a player feels them, on the real sims: she plays with the chase
// pin (W toward a boat, Space once locked), the way tools/v2-perf.mjs's evidence does.
//   camping one boat: the Halcyon knocked again every 46 s paid more than roaming (6 XP a knock); now the same boat within 120 s pays
//     half a time (v2/sim/tessieBounty.js repeatS), and the skipper's line says why once
//   the next boat: the swim between two wrecks was about 80 % of the time between them (a 30 min chase: 18 wrecks); 6 s after a wreck
//     with no fresh upright boat within 220 m, one is laid 130–210 m ahead of her (cheat on where, as her entry's first boat)
import test from 'node:test';
import assert from 'node:assert/strict';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlayer, REPEAT_LINE, PLAYER } from '../living/tessiePlayer.js';
import { createBusyLake } from '../living/busyLake.js';
import { birthplaceRows } from '../sim/regions.js';
import { BOUNTY } from '../sim/tessieBounty.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BIRTHPLACES = birthplaceRows(JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8')));

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

// her far out (2 km from the fleet) with the busy lake settled in 10 kn; a Tail Surge ready (rank 1)
function lakeRig() {
  const ms = 10 * KN, L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: deep, windAt: steadyWind(ms, 225), tier: 'full', starts: [] });
  const S = { x: 460, z: -50, heading: 0, u: 0, v: 0, yawRate: 0 };
  let t = 0; for (let i = 0; i < 30 / DT; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
  const wind = { pattern: null, base: { dirDeg: 225, speedMs: ms }, setLevel() { return 1; }, sample(x, z, tt) { const v = steadyWind(ms, 225)(x, z, tt); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
  const storage = memStore({ [BOUNTY.key]: JSON.stringify({ _v: BOUNTY.v, xp: 600, ranks: { dash: 1, lure: 1, sonar: 1, surge: 1 } }) });
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage, rpg: true, busy: () => L, day: () => '2026-07-04' });
  const at = { x: 2000, z: 2000 }, bb = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 }, view = { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 };
  sim.ambush(at.x, at.z, 0, 0.2); sim.hunt(false);
  for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: bb, view });
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  assert.ok(P.become('swap').ok);
  const step = (secs) => { for (let k = 0; k < Math.round(secs / DT); k++) { const th = P.threat(); L.post(S, DT, t, { hour: 13, others: th ? [th] : [] }); t += DT; sim.step(DT, { playing: true, boat: bb, view }); P.step(DT); } };
  const place = (b, d, a) => { const c = sim.state.centre, q = b.phys.state; q.x = c[0] + Math.sin(a) * d; q.z = c[1] - Math.cos(a) * d; };
  // a Tail Surge knocks the first boat (laid upright 5 m off her side): a real wreck
  const wreck = (b) => { assert.equal(P.pressSlot('surge'), 'fire'); step(1.0); place(b, 6.5, Math.PI / 2); b.phys.state.heel = 0; b.phys.p = 0; step(1.5); assert.ok(b.knock, 'knocked down'); };
  return { P, L, sim, step, place, wreck };
}

test('the next boat: 6 s after a wreck with no fresh boat within 220 m, one is laid 130–210 m ahead of her; never when one is near', () => {
  const r = lakeRig(), [b0, b1] = r.L.liveBoats;
  r.wreck(b0);
  assert.equal(r.P.stats().log.reach?.next, undefined, 'not at once (the knockdown is the moment)');
  r.step(PLAYER.nextDelayS);
  const reach = r.P.stats().log.reach;
  assert.ok(reach?.next, `a boat laid after the wreck (${JSON.stringify(reach)})`);
  assert.notEqual(reach.id, b0.id, 'never the boat just wrecked');
  const laid = r.L.liveBoats.find((b) => b.id === reach.id).phys.state, n = r.sim.state.nose;
  const d = Math.hypot(laid.x - n.x, laid.z - n.z), off = Math.abs(Math.atan2(Math.sin(Math.atan2(laid.x - n.x, -(laid.z - n.z)) - n.psi), Math.cos(Math.atan2(laid.x - n.x, -(laid.z - n.z)) - n.psi)));
  assert.ok(d >= 120 && d <= 220 && off < 25 * Math.PI / 180, `130–210 m ahead (${d.toFixed(0)} m, ${(off * 180 / Math.PI).toFixed(0)}° off her nose)`);
  // a fresh boat 100 m off: nothing laid
  const q = lakeRig(), [c0, c1] = q.L.liveBoats;
  q.place(c1, 100, Math.PI);
  q.wreck(c0);
  q.step(PLAYER.nextDelayS + 1);
  assert.equal(q.P.stats().log.reach?.next, undefined, 'a boat 100 m off: no cheat');
});
