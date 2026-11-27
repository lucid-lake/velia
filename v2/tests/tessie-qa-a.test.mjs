// The Tessie RPG's QA round A (?tessierpg=1): a boat is wrecked once per grace, whatever the path (the bite, the fall, the Tail Surge's
// slap, the Breach's beside-wave); the Breach never runs at a boat in its grace; one bounty for the page in a private window; the
// fastest record from a ping or a lure; a newer save is never written over; a free trial is spent only when the skill touched a boat;
// "Tessie's up." jumps the 20 s gap; a swap back mid-skill clears it. Behaviour only, on the real sims. Run: npm run test:v2
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createBusyLake } from '../living/busyLake.js';
import { birthplaceRows } from '../sim/regions.js';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlayer } from '../living/tessiePlayer.js';
import { BOUNTY } from '../sim/tessieBounty.js';
import { BREACH_RANKS, breachTarget, breachBeside } from '../sim/tessieBreach.js';
import { SURGE_RANKS, surgeResolve } from '../sim/tessieSurge.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BIRTHPLACES = birthplaceRows(JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8')));
const DT = 1 / 30, DEG = Math.PI / 180, KN = 0.514444, deep = () => 40;
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const save = (ranks, trials = null, xp = 1045) => memStore({ [BOUNTY.key]: JSON.stringify({ _v: BOUNTY.v, xp, ranks: { dash: 1, lure: 1, sonar: 1, surge: 1, ...ranks }, ...(trials ? { trials } : {}) }) });

function lake(ms = 6) {
  const L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: deep, windAt: steadyWind(ms, 225), tier: 'full', starts: [] });
  const S = { x: 460, z: -50, heading: 0, u: 0, v: 0, yawRate: 0 };
  let t = 0;
  for (let i = 0; i < 30 / DT; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
  return { L, S, t };
}
// the player as her on the busy lake, far from the Halcyon (phase 4's rig)
function rig({ storage, at = { x: 2000, z: 2000 }, heading = 0, world = lake(), kayaks = () => null, services = () => null } = {}) {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1, playK: 1 };
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage, rpg: true, busy: () => world.L, kayaks, services, day: () => '2026-07-04' });
  const b0 = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 };
  sim.ambush(at.x, at.z, heading, 0.2); sim.hunt(false);
  for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: b0, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  assert.ok(P.become('swap').ok);
  let clock = 0;
  const step = (secs, each = null) => {
    for (let k = 0; k < Math.round(secs / DT); k++) {
      const th = P.threat();
      world.L.post(world.S, DT, world.t, { hour: 13, others: th ? [th] : [] }); world.t += DT;
      sim.step(DT * (plugin.playK ?? 1), { playing: true, boat: b0, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
      P.step(DT); clock += DT;
      if (each?.() === true) return true;
    }
    return false;
  };
  return { P, sim, B, world, step, plugin, get clock() { return clock; } };
}
// a boat moved (its physics kept) to d m from her nose on her heading turned by a (rad); every other boat sent 5 km off
function place(b, sim, d, a = 0) { const n = sim.state.nose, q = b.phys.state; q.x = n.x + Math.sin(n.psi + a) * d; q.z = n.z - Math.cos(n.psi + a) * d; }
function alone(world, keep) { for (const b of world.L.liveBoats) if (b !== keep) b.phys.state.x += 5000; }
const entry = (b) => { const q = b.phys.state; return { id: b.id, kind: 'sail', x: q.x, z: q.z, heading: q.heading, L: 8.5, B: 3 }; };

// ---- finding 1: one wreck per grace ----
test('the Halcyon bitten, then a Tail Surge within 1 s (wind 7 m/s): wrecked once, not twice; the slap only heels her', () => {
  for (const delay of [0, 0.4, 1.0]) {
    const wind = { pattern: null, base: { dirDeg: 200, speedMs: 7 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(7, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
    const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
    for (let i = 0; i < 300; i++) B.step?.(DT);
    const sim = createTessie({ seed: 1, depthAt: deep });
    const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
    const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage: save({ surge: 1 }), rpg: true, day: () => '2026-07-04' });
    const at = { x: B.state.x + 30, z: B.state.z + 30 };
    const b0 = () => ({ x: B.state.x, z: B.state.z, heading: B.state.heading, speed: B.state.u ?? 0 });
    sim.ambush(at.x, at.z, -Math.PI * 0.75, 0.2); sim.hunt(false);
    for (let k = 0; k < 3 / DT; k++) sim.step(DT, { playing: true, boat: b0(), view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
    P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
    P.swap.step(DT, { on: true, shown: true, distM: 40 });
    assert.ok(P.become('swap').ok);
    const step = (secs) => { for (let k = 0; k < Math.round(secs / DT); k++) { B.step?.(DT); const n = sim.state.nose; sim.step(DT, { playing: true, boat: b0(), view: { x: n.x, z: n.z + 40, yaw: 0, hHalf: 0.6 } }); P.step(DT); P.camera(DT, { pos: [n.x, 3, n.z + 20], target: [n.x, 1, n.z], fov: 55 }); } };
    P.pin({ nose: 0, chase: 'halcyon' });
    let t = 0; while (t < 30 && !P.stats().log.knocks.length) { step(DT); t += DT; }
    assert.equal(P.bounty.state().byType.halcyon.wrecked, 1, `bitten (${t.toFixed(1)} s)`);
    P.pin(null); step(delay);
    assert.equal(P.pressSlot('surge'), 'fire');
    step(4);
    const L = P.stats().log;
    assert.equal(L.knocks.filter((k) => k.id === 'halcyon').length, 1, `+${delay} s: one knockdown (slap ${JSON.stringify(L.surge?.slap?.knock)})`);
    assert.equal(P.bounty.state().byType.halcyon.wrecked, 1, `+${delay} s: wrecked once`);
    assert.equal(L.surge.slap.knock, null, 'the slap never picks a boat in its grace');
  }
});

test('the pure rules: a boat in its grace never goes over (the slap\'s pick, the beside-wave\'s rank 4); it still heels', () => {
  const row = SURGE_RANKS[1], b = { id: 'b1', kind: 'sail', x: 0, z: -8, heading: Math.PI / 2, heelDeg: 25, twsMs: 15 * KN };
  assert.equal(surgeResolve({ x: 0, z: 0 }, [b], row).knock?.id, 'b1', 'out of grace: over');
  const g = surgeResolve({ x: 0, z: 0 }, [b], row, { grace: (id) => id === 'b1' });
  assert.equal(g.knock, null, 'in its grace: not over');
  assert.deepEqual(g.heels.map((h) => h.id), ['b1'], 'it heels');
  const r4 = BREACH_RANKS[4], fall = { x: 0, z: -8 - 8, psi: Math.PI / 2 };   // her front lands 8 m off the hull: beside it
  const bb = { ...b, heading: Math.PI / 2 };
  assert.equal(breachBeside(fall, [bb], r4)?.knock, true, 'rank 4 out of grace: over');
  const gb = breachBeside(fall, [bb], r4, { grace: () => true });
  assert.equal(gb?.knock, false, 'in its grace: only the wave');
  assert.equal(gb.heelDeg, 35);
});

test('a Tail Surge knockdown starts the 45 s grace (the corners and the bite skip it after)', () => {
  const world = lake(24 * KN);
  const { P, sim, step } = rig({ storage: save({ surge: 1 }), world });
  step(0.1);
  const boat = world.L.liveBoats.find((b) => Math.abs(b.phys.state.heel ?? 0) > 14 * DEG) ?? world.L.liveBoats[0];
  alone(world, boat);
  const c = sim.state.centre, q = boat.phys.state; q.x = c[0] + 8; q.z = c[1];
  assert.equal(P.pressSlot('surge'), 'fire');
  step(3);
  assert.deepEqual(P.stats().log.surge.slap.over, [boat.id], `over (${JSON.stringify(P.stats().log.surge.slap)})`);
  assert.equal(P.hits.grace(boat.id, 10), true, 'in its grace after the slap');
  assert.equal(P.hits.grace(boat.id, 60), false, 'out of it 45 s on');
});

// ---- finding 2: the Breach never runs at a boat in its grace ----
test('the Breach: breachTarget skips a boat in its grace; a press with only graced boats in reach is a quiet no-op (no trial spent)', () => {
  const her = { x: 0, z: 0, psi: 0 }, a = { id: 'a', kind: 'sail', x: 0, z: -30, heading: 0, L: 8.5, B: 3 }, b = { id: 'b', kind: 'sail', x: 0, z: -50, heading: 0, L: 8.5, B: 3 };
  assert.equal(breachTarget(her, [a, b]).id, 'a');
  assert.equal(breachTarget(her, [a, b], { grace: (id) => id === 'a' }).id, 'b', 'the graced one skipped');
  assert.equal(breachTarget(her, [a, b], { lockId: 'a', grace: (id) => id === 'a' }).id, 'b', 'even when locked');
  assert.equal(breachTarget(her, [a], { grace: () => true }), null);
  const world = lake();
  const { P, sim, step } = rig({ storage: save({ breach: 0 }, { lure: 5, sonar: 5, surge: 5, breach: 5 }), world });
  step(0.5);
  const boat = world.L.liveBoats[0]; alone(world, boat); place(boat, sim, 40);
  step(DT);
  const e = entry(boat);
  assert.ok(P.hits.contact({ x: e.x + 1.5, z: e.z, y: 0 }, [e], 0).hit, 'knocked (its grace from t 0 to 45 s)');
  assert.equal(P.pressSlot('breach'), 'idle', 'only a graced boat in reach: nothing to run at');
  assert.equal(P.bounty.state().trials.breach, 5, 'no free trial spent');
  assert.equal(P.stats().rpg.breachFx, null);
});

// ---- finding 3: one bounty for the page when the store cannot hold it ----
test('a private window: the player\'s and the Logbook\'s bounties are one (no store, a store that throws, one that refuses writes)', async () => {
  const { createTessieBounty } = await import('../sim/tessieBounty.js');
  const refuses = (seed) => { const m = new Map(seed ? [[BOUNTY.key, seed]] : []); return { getItem: (k) => m.get(k) ?? null, setItem: () => { throw new Error('quota'); }, map: m }; };
  const throws = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  for (const [name, storage] of [['no store', null], ['a store that throws', throws], ['a store that refuses writes', refuses(null)], ['refuses writes, an old save', refuses(JSON.stringify({ _v: 2, xp: 12 }))]]) {
    const play = createTessieBounty({ storage }), book = createTessieBounty({ storage });
    const xp0 = play.state().xp;
    for (let i = 0; i < 2; i++) play.score({ kind: 'sail', depthM: 0 });
    assert.equal(book.state().xp, play.state().xp, `${name}: the Logbook reads the play's XP`);
    assert.ok(play.state().xp > xp0);
    assert.equal(book.state().level, play.state().level, `${name}: the same level`);
    assert.ok(book.state().points >= 1, `${name}: a point to spend`);
    assert.equal(book.spend('lure').ok, true, `${name}: spending works from the Logbook`);
    assert.equal(play.state().ranks.lure, 1, `${name}: and the play sees the rank`);
  }
  // the player made the way the page makes it (living/lakePlugins.js: no storage passed, globalThis.localStorage absent)
  const P = createTessiePlayer({ plugin: { sim: createTessie({ seed: 1, depthAt: deep }), render: { ready: true }, playDip: 1 }, B: createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: { pattern: null, base: { dirDeg: 0, speedMs: 5 }, setLevel() { return 1; }, sample: () => ({ vx: 0, vz: 0 }) }, headless: true }), headless: true, rpg: true, storage: null });
  const book = createTessieBounty({ storage: null });
  P.bounty.score({ kind: 'glass', depthM: 0 });
  assert.equal(book.state().xp, P.bounty.state().xp, 'the page\'s two holders agree');
});

// ---- finding 5: a save of an unknown _v is never written over ----
test('a save of a newer _v is kept untouched in the store (read in memory, play kept for the session); no _v with XP migrates, XP kept', async () => {
  const { createTessieBounty, migrate } = await import('../sim/tessieBounty.js');
  const raw = JSON.stringify({ _v: 3, xp: 500, ranks: { dash: 2, lure: 2 }, future: { x: 1 } });
  const st = memStore({ [BOUNTY.key]: raw }), T = createTessieBounty({ storage: st });
  assert.equal(T.state().xp, 500, 'read as well as it can be');
  assert.equal(T.state().ranks.lure, 2);
  assert.equal(st.map.get(BOUNTY.key), raw, 'not written on the first read');
  T.score({ kind: 'sail', depthM: 0 });
  assert.ok(T.state().xp > 500, 'the session\'s play kept in memory');
  assert.equal(st.map.get(BOUNTY.key), raw, 'never written over, even after a score');
  assert.equal(createTessieBounty({ storage: st }).state().xp, T.state().xp, 'another holder of the store sees the same session');
  assert.equal(migrate(raw, null).frozen, true);
  const old = memStore({ [BOUNTY.key]: JSON.stringify({ xp: 500, byType: { sail: { wrecked: 7 } } }) }), U = createTessieBounty({ storage: old });
  assert.equal(U.state().xp, 500, 'no _v: the XP kept');
  assert.equal(U.state().byType.sail.wrecked, 7, 'and the counts');
  assert.equal(JSON.parse(old.map.get(BOUNTY.key))._v, BOUNTY.v, 'migrated and written as today\'s _v');
  assert.equal(migrate(JSON.stringify({ hello: 1 }), '3').save.byType.sail.wrecked, 3, 'no _v and nothing of a save: a new one (the old knock total carried)');
});
