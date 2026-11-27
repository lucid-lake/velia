// The Tessie RPG's skill effects: each skill lays its own look on the water and in the air, none the old shared ring. Behaviour on
// the real sims (her sim, the busy lake, her player, her spray): a press of each slot, then what her water map's skill waves, her
// rings and her spray hold. The Dash: a boil, the bow's spray, a churned trail, her V stronger. The Lure: ripples closing in, fish
// flicking toward her, a school's shimmer (only tiny plops as rings). The Sonar: the pulse only (no wave, no spray). The Tail Surge:
// a swell rolling out with spume off its crest and spray up each hull it reaches (no ring). The Breach: the run-up's V, the
// landing's column, a short landing swell and its foam. Also: the events emitted after her frame's effects read them wait for her
// next step (the slap's spray is no longer lost), the swell's shape and the map's extent, the tiers' spray budgets, determinism.
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
import { createTessieFx } from '../living/tessie-fx.js';
import { createTessiePlayer, SKILL_FX } from '../living/tessiePlayer.js';
import { BOUNTY } from '../sim/tessieBounty.js';
import { SKILL_WAVE_KIND, SKILL_WAVE_MAX, mapExtent, swellHeight, MAP_E } from '../sim/tessieWaves.js';
import { SURGE } from '../sim/tessieSurge.js';
import { FX } from '../render/tessie.js';
import { CREATURE, CREATURE_VEC4 } from '../render/creature-map.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);
const DT = 1 / 30, deep = () => 40;
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const save = () => memStore({ [BOUNTY.key]: JSON.stringify({ _v: BOUNTY.v, xp: 900, ranks: { dash: 1, lure: 1, sonar: 1, surge: 1, breach: 1 } }) });
const KIND = Object.fromEntries(Object.entries(SKILL_WAVE_KIND).map(([k, v]) => [v, k]));

function lake() {
  const L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: deep, windAt: steadyWind(5, 225), tier: 'full', starts: [] });
  const S = { x: 460, z: -50, heading: 0, u: 0, v: 0, yawRate: 0 };
  let t = 0;
  for (let i = 0; i < 20 / DT; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
  return { L, S, t };
}
// her player on the real busy lake with her real spray (the plug-in's skillFx at a tier), far from the Halcyon
function rig({ tier = 'full', at = { x: 2000, z: 2000 } } = {}) {
  const world = lake();
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const fx = createTessieFx({ seed: 1, skillK: tier === 'lite' ? 0.5 : tier === 'none' ? 0 : 1 });
  // what each step leaves: the skill waves' kinds seen, the rings the player laid (their amplitudes), the events her spray read, the
  // skill spray's drops, the most drops and waves at once
  const seen = { waves: new Set(), rings: [], events: new Set(), skillDrops: 0, maxDrops: 0, maxWaves: 0, maxReach: 0 };
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1, playK: 1, skillFx: (t, o) => { const n = fx.skill(t, o); seen.skillDrops += n; return n; }, skillTier: tier };
  const ring0 = sim.ring; sim.ring = (x, z, a) => { seen.rings.push(a); return ring0(x, z, a); };
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage: save(), rpg: true, busy: () => world.L, slowBreach: () => false, day: () => '2026-07-04' });
  const b0 = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 };
  const view = { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 };
  sim.ambush(at.x, at.z, 0, 0.2); sim.hunt(false);
  for (let k = 0; k < 6 / DT; k++) { sim.step(DT, { playing: true, boat: b0, view }); fx.step(DT, sim.state); sim.consumed(); }
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  assert.ok(P.become('swap').ok);
  const step = (secs, each = null) => {
    for (let k = 0; k < Math.round(secs / DT); k++) {
      world.L.post(world.S, DT, world.t, { hour: 13 }); world.t += DT;
      sim.step(DT * (plugin.playK ?? 1), { playing: true, boat: b0, view });
      fx.step(DT, sim.state);
      for (const e of sim.state.events) seen.events.add(e.type);
      sim.consumed();
      P.step(DT);
      const W = sim.state.water;
      for (const w of W.skill) seen.waves.add(KIND[w[3]]);
      seen.maxDrops = Math.max(seen.maxDrops, fx.drops.length); seen.maxWaves = Math.max(seen.maxWaves, W.skill.length); seen.maxReach = Math.max(seen.maxReach, W.reach);
      if (each?.() === true) return true;
    }
    return false;
  };
  step(0.5);
  const clear = () => { seen.waves.clear(); seen.rings.length = 0; seen.events.clear(); seen.maxDrops = 0; seen.skillDrops = 0; };
  return { P, sim, fx, world, step, seen, clear };
}
// a sailboat of the busy lake moved to d m off her nose, a rad off her heading
const place = (world, sim, d, a = 0) => { const b = [...world.L.liveBoats][0], n = sim.state.nose, q = b.phys.state; q.x = n.x + Math.sin(n.psi + a) * d; q.z = n.z - Math.cos(n.psi + a) * d; return b; };
const kinds = (P, id) => P.stats().log.fx[id].slice().sort();

test('the Dash: a boil where she kicks, the bow\'s spray and a churned trail, her V stronger; no ring, no swell', () => {
  const { P, fx, step, seen, clear } = rig();
  clear();
  assert.equal(P.pressSlot('dash'), 'fire');
  step(1.5);
  const k = kinds(P, 'dash');
  for (const want of ['boil', 'bow', 'churn', 'wake']) assert.ok(k.includes(want), `the dash lays ${want} (${k})`);
  assert.ok(fx.stats.skills.bow > 20, `the bow's spray each step at the surface (${fx.stats.skills.bow})`);
  assert.deepEqual([...seen.waves], ['churn'], 'only churned water on her map (the boil and the trail)');
  assert.equal(seen.rings.length, 0, 'no ring of its own');
});

test('the Lure: ripples closing in on her, fish flicking toward her, a school\'s shimmer, the tail\'s flick; never an outward ring', () => {
  const { P, sim, step, seen, clear } = rig();
  clear();
  assert.equal(typeof P.pressSlot('lure'), 'string');
  const radii = [];
  step(2.5, () => { const w = sim.state.water.skill.find((s) => s[3] === SKILL_WAVE_KIND.inward); if (w) radii.push(Math.max(0, w[4] - w[5] * w[2])); });
  const k = kinds(P, 'lure');
  for (const want of ['flick', 'hop', 'inward', 'shimmer']) assert.ok(k.includes(want), `the lure lays ${want} (${k})`);
  assert.ok(seen.waves.has('inward') && !seen.waves.has('swell'), `inward ripples, no swell (${[...seen.waves]})`);
  assert.ok(radii.length > 10 && radii.at(-1) < radii[0] - 8, `the ripples close in on her (${radii[0]?.toFixed(1)} → ${radii.at(-1)?.toFixed(1)} m)`);
  assert.ok(seen.rings.length > 0 && seen.rings.every((a) => a <= SKILL_FX.lure.plop + 1e-9), `only the fish's tiny plops as rings (amp ${seen.rings.map((a) => a.toFixed(2))})`);
  assert.ok(seen.events.has('flick'), 'her tail\'s flick reaches her spray (emitted after her frame read the events: queued, not lost)');
});

test('the Sonar: the pulse only (no wave, no spray, no ring on her water)', () => {
  const { P, sim, fx, step, seen, clear, world } = rig();
  place(world, sim, 120);
  clear();
  const s0 = fx.stats.spawned;
  P.pressSlot('sonar');
  step(1.2);
  assert.deepEqual(kinds(P, 'sonar'), ['pulse']);
  assert.equal(seen.waves.size, 0, 'nothing on her water');
  assert.equal(seen.rings.length, 0, 'no ring');
  assert.equal(Object.keys(fx.stats.skills).length, 0, `no skill spray (${JSON.stringify(fx.stats.skills)}; ${fx.stats.spawned - s0} drops from her own breathing)`);
});

test('the Tail Surge: the wind-up churns, the slap\'s spray, a swell rolling out to the ring radius with spume off its crest, spray up the hull it reaches; no ring', () => {
  const { P, sim, fx, step, seen, clear, world } = rig();
  place(world, sim, 22, 0.6);
  clear();
  assert.equal(typeof P.pressSlot('surge'), 'string');
  const crest = [];
  step(SURGE.windupS + SURGE.waveS + 0.4, () => { const w = sim.state.water.skill.find((s) => s[3] === SKILL_WAVE_KIND.swell); if (w) crest.push({ age: w[2], r: Math.min(w[5], w[4] * w[2]), speed: w[4], maxR: w[5] }); });
  const k = kinds(P, 'surge');
  for (const want of ['churn', 'crest', 'flick', 'hull', 'slap', 'swell']) assert.ok(k.includes(want), `the surge lays ${want} (${k})`);
  assert.ok(seen.events.has('slap') && seen.events.has('flick'), `the slap and the flick reach her spray (${[...seen.events]})`);
  assert.ok(seen.waves.has('swell') && seen.waves.has('churn') && !seen.waves.has('inward'), `${[...seen.waves]}`);
  assert.equal(seen.rings.length, 0, `no ring: the swell is the wave (${seen.rings})`);
  const last = crest.at(-1);
  assert.ok(crest.length > 20 && Math.abs(crest[0].speed - 40 / SURGE.waveS) < 1e-9 && last.r === last.maxR && last.maxR === 40, `the swell runs out at 20 m/s to 40 m (${JSON.stringify(last)})`);
  assert.ok(seen.maxReach > 40 && mapExtent(seen.maxReach) > MAP_E.base, `her map widens to hold it (reach ${seen.maxReach.toFixed(1)} m, side ${mapExtent(seen.maxReach).toFixed(0)} m)`);
  assert.ok(fx.stats.skills.crest > 10 && fx.stats.skills.hull >= 1, `${JSON.stringify(fx.stats.skills)}`);
});

test('the Breach: the run-up\'s V over her, the landing\'s column, a short landing swell and its foam', () => {
  const { P, sim, fx, step, seen, clear, world } = rig();
  place(world, sim, 45);
  clear();
  assert.equal(P.pressSlot('breach'), 'fire');
  let ghost = false;
  step(0.6, () => { ghost ||= sim.state.water.kelvin.length > 0 && sim.state.nose.dy < -3; });
  P.releaseSlot('breach');
  step(5);
  const k = kinds(P, 'breach');
  for (const want of ['churn', 'column', 'runV', 'swell']) assert.ok(k.includes(want), `the breach lays ${want} (${k})`);
  assert.ok(fx.stats.skills.column === 1 && seen.waves.has('swell') && seen.waves.has('churn'), `${JSON.stringify(fx.stats.skills)} ${[...seen.waves]}`);
  assert.ok(SKILL_FX.breach.swell.maxR < 40 && SKILL_FX.breach.swell.speed < 20, 'its landing wave is short and slow beside the Surge\'s');
  assert.ok(ghost || P.stats().log.fx.breach.includes('runV'), 'the run-up shows its V');
});

test('each skill reads apart: no two lay the same set of looks', () => {
  const sets = {};
  for (const id of ['dash', 'lure', 'sonar', 'surge']) {
    const { P, step, world, sim } = rig();
    if (id === 'surge') place(world, sim, 22, 0.6);
    P.pressSlot(id); step(id === 'surge' ? 3.6 : 2);
    sets[id] = kinds(P, id).join();
  }
  const vals = Object.values(sets);
  assert.equal(new Set(vals).size, vals.length, JSON.stringify(sets));
});

test('the swell\'s shape: one raised crest at speed × age with a shallow trough behind it, lower as it spreads; the map\'s extent', () => {
  const p = [20, 40, 1.3, 3.0];
  for (const age of [0.5, 1.0, 1.8]) {
    let best = -Infinity, at = 0;
    for (let d = 0; d < 60; d += 0.1) { const h = swellHeight(p, age, d); if (h > best) { best = h; at = d; } }
    assert.ok(Math.abs(at - 20 * age) < 0.6, `the crest at ${(20 * age).toFixed(0)} m (${at.toFixed(1)})`);
    assert.ok(swellHeight(p, age, 20 * age - 4.8) < 0, 'a trough behind it');
  }
  assert.ok(swellHeight(p, 1.8, 36) < swellHeight(p, 0.5, 10), 'lower as it spreads');
  assert.equal(swellHeight(p, 3.0, 40), 0, 'gone 0.6 s of run past its ring');
  assert.equal(mapExtent(0), 64); assert.equal(mapExtent(20), 64); assert.equal(mapExtent(1000), MAP_E.maxE);
  assert.ok(mapExtent(46) * 0.28 < 46 && mapExtent(46) * MAP_E.fadeAt >= 46 - 1e-9, 'the map\'s round fade starts beyond the wave');
  assert.equal(CREATURE.maxS, SKILL_WAVE_MAX * 2); assert.equal(CREATURE_VEC4, 2 + CREATURE.maxK + CREATURE.maxR + CREATURE.maxC + CREATURE.maxS);
});

test('budgets by tier: lite throws about half the spray, none throws none; the drop pool and the wave slots never overflow', () => {
  const spawned = {};
  for (const tier of ['full', 'lite', 'none']) {
    const { P, step, world, sim, fx, seen } = rig({ tier });
    place(world, sim, 22, 0.6);
    seen.skillDrops = 0;
    P.pressSlot('surge'); step(1.6); P.pressSlot('lure'); P.pressSlot('dash'); step(2.4);
    spawned[tier] = { drops: seen.skillDrops, skills: Object.values(fx.stats.skills).reduce((a, b) => a + b, 0), waves: seen.maxWaves, maxDrops: seen.maxDrops };
    assert.ok(seen.maxDrops <= FX.drops, `${tier}: the pool's cap holds (${seen.maxDrops} ≤ ${FX.drops})`);
    assert.ok(seen.maxWaves <= SKILL_WAVE_MAX, `${tier}: at most ${SKILL_WAVE_MAX} skill waves (${seen.maxWaves})`);
  }
  const r = spawned.lite.drops / spawned.full.drops;
  assert.ok(r > 0.3 && r < 0.75, `lite: about half the drops (${JSON.stringify(spawned)})`);
  assert.equal(spawned.none.skills, 0, 'none: no skill spray'); assert.equal(spawned.none.drops, 0);
  assert.equal(spawned.none.waves, 0, 'none: no skill waves');
});

test('an event emitted after her frame\'s effects read them waits for her next step; deterministic spray', () => {
  const sim = createTessie({ seed: 1, depthAt: deep });
  sim.ambush(0, 0, 0, 1);
  sim.step(DT, { playing: true });
  sim.consumed();
  sim.emit('slap', 'tail', 1);
  assert.ok(!sim.state.events.some((e) => e.type === 'slap'), 'not in the frame already read');
  sim.step(DT, { playing: true });
  assert.ok(sim.state.events.some((e) => e.type === 'slap'), 'in the next step\'s events');
  sim.step(DT, { playing: true });
  assert.ok(!sim.state.events.some((e) => e.type === 'slap'), 'once');
  sim.emit('flick', 'tail');
  assert.ok(sim.state.events.some((e) => e.type === 'flick'), 'before the frame is read: this frame\'s, as before');
  const run = () => { const f = createTessieFx({ seed: 3 }); f.skill('column', { x: 1, z: 2 }); f.skill('crest', { x: 0, z: 0, r: 9 }); for (let i = 0; i < 20; i++) f.step(DT, { visible: false }); return JSON.stringify(f.drops); };
  assert.equal(run(), run());
});
