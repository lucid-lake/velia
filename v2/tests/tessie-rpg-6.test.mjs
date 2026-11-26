// The Tessie RPG, phase 6a (?tessierpg=1): the lake grows wary by her level (v2/sim/tessieWary.js: sight 60 → 90 m, the kayaks'
// 100 m berth, the chatter lines, the Halcyon never lured from level 13), the boats at anchor knocked down and scored, a Regatta rival
// and the paddle-wheeler scored, the sets (+25 XP once, the legend line once on the skipper's line), a save from before phase 6 kept whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createBusyLake } from '../living/busyLake.js';
import { createKayakFleet } from '../sim/kayaks.js';
import { makeTerrain } from './helpers/ground.mjs';
import { birthplaceRows } from '../sim/regions.js';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlayer } from '../living/tessiePlayer.js';
import { createAnchoredBoats, knockHeel, ANCHORED } from '../sim/anchoredBoats.js';
import { createTessieHits, hitRule } from '../sim/tessieHits.js';
import { BOUNTY, BOUNTY_KIND, SETS, TYPES, blankSave, scoreInto, migrate, normalise, setProgress, createTessieBounty } from '../sim/tessieBounty.js';
import { WARY, waryOf, chatterLine, CHATTER } from '../sim/tessieWary.js';
import { classOf } from '../ui/leanSkipper.js';
import { tessiePage } from '../ui/tessieLog.js';
import { wrap } from '../../src/sim/core/math.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);
const DEG = Math.PI / 180, DT = 1 / 30, deep = () => 40, WIND_FROM = 225;
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m }; };
const atXp = (xp) => memStore({ [BOUNTY.key]: JSON.stringify({ _v: BOUNTY.v, xp, ranks: { dash: 1, lure: 4 } }) });   // lure 4: every level here has the points

function lake() {
  const L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: deep, windAt: steadyWind(6, WIND_FROM), tier: 'full', starts: [] });
  const S = { x: 460, z: -50, heading: 0, u: 0, v: 0, yawRate: 0 };
  let t = 0;
  for (let i = 0; i < 60; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
  return { L, S, t };
}
// the player as her (rpg on), rising at `at`; anchored, kayaks, rivals, traffic: the world's sources
function rig({ storage, at, heading = 0, world = lake(), anchored = () => null, kayaks = () => null, rivals = () => null, traffic = () => [], chatter = () => true } = {}) {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage, rpg: true, busy: () => world.L, anchored, kayaks, rivals, traffic, chatter, day: () => '2026-07-04' });
  const b0 = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 };
  sim.ambush(at.x, at.z, heading, 0.2); sim.hunt(false);
  for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: b0, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  const r = P.become('swap');
  assert.ok(r.ok, JSON.stringify(r));
  const step = (secs, each = null) => {
    for (let k = 0; k < Math.round(secs / DT); k++) {
      const th = P.threat();
      world.L.post(world.S, DT, world.t, { hour: 13, others: th ? [th] : [] });
      anchored()?.post?.(world.S, DT, world.t, () => WIND_FROM);
      world.t += DT;
      const n = sim.state.nose;
      sim.step(DT, { playing: true, boat: b0, view: { x: n.x, z: n.z + 40, yaw: 0, hHalf: 0.6 } });
      P.step(DT);
      P.camera(DT, { pos: [n.x, 3, n.z + 20], target: [n.x, 1, n.z], fov: 55 });
      if (each?.() === true) return true;
    }
    return false;
  };
  return { P, sim, world, step, her: () => sim.state.nose };
}

test('the wary bands: levels 1–5 sight 60 m; 6–12 90 m, the kayaks 100 m off, the chatter; 13–20 the rivals wide, the Halcyon flees', () => {
  assert.deepEqual([1, 5, 6, 12, 13, 20].map((L) => waryOf(L).seeM), [60, 60, 90, 90, 90, 90]);
  assert.deepEqual([5, 6, 13].map((L) => waryOf(L).kayakBerthM), [0, 100, 100]);
  assert.deepEqual([5, 6, 13].map((L) => waryOf(L).chatter), [false, true, true]);
  assert.deepEqual([12, 13].map((L) => [waryOf(L).halcyonFlees, waryOf(L).rivalBerthM > 0]), [[false, false], [true, true]]);
  assert.equal(waryOf(undefined), WARY[0]);
  // the chatter: the Fannette line near the island, the other elsewhere; none once asked or shown
  assert.equal(chatterLine({ x: 300, z: -200 }).text, 'Something big off Fannette, keep east.');
  assert.equal(chatterLine({ x: 4000, z: 6000 }).kind, CHATTER[1].kind);
  assert.equal(chatterLine({ x: 300, z: -200 }, (k) => k === CHATTER[0].kind), null);
  for (const k of [...CHATTER.map((c) => c.kind), ...SETS.map((s) => s.kind)]) assert.equal(classOf(k), 'tip', `${k}: a TIP (once ever, the lean skipper's gap and busy rules)`);
});

test('as her: sight 60 m at level 5 and 90 m at level 6; a boat 75 m off bears away only at level 6 (the busy lake\'s evade)', () => {
  const run = (xp) => {
    const world = lake(), b = world.L.liveBoats[0], q = b.phys.state;
    const at = { x: q.x + Math.sin(q.heading) * 75, z: q.z - Math.cos(q.heading) * 75 };   // 75 m dead ahead of the boat
    const r = rig({ storage: atXp(xp), at, heading: q.heading, world });
    const n0 = r.her(), h = q.heading, e0 = world.L.stats.evades;   // the boat laid 75 m from her nose, sailing at her
    assert.ok(world.L.lay(b.id, { x: n0.x - Math.sin(h) * 75, z: n0.z + Math.cos(h) * 75, heading: h, speed: 2.6 }));
    r.step(0.1);
    const d0 = Math.hypot(q.x - r.her().x, q.z - r.her().z);
    r.step(1.5);
    return { seeM: r.P.threat()?.seeM ?? null, evades: world.L.stats.evades - e0, evading: b.evade != null, d: d0, level: r.P.stats().rpg.level };
  };
  const five = run(70), six = run(100);
  assert.equal(five.level, 5); assert.equal(six.level, 6);
  assert.equal(five.seeM, 60, 'level 5: seen within 60 m at the surface'); assert.equal(six.seeM, 90, 'level 6: 90 m');
  assert.ok(five.d > 60 && five.d < 90 && six.d > 60 && six.d < 90, `the boat between 60 and 90 m off (${five.d.toFixed(0)}, ${six.d.toFixed(0)} m)`);
  assert.equal(five.evades, 0, 'level 5: the boat has not seen her'); assert.equal(five.evading, false);
  assert.ok(six.evades > 0 && six.evading, `level 6: it sees her and bears away (${six.evades})`);
});

test('the kayaks\' berth: at 100 m they paddle away from her water; with no berth they paddle on until 40 m (the watch)', () => {
  const one = () => {
    const START = { x: 1200, z: -1050, heading: 251 * DEG }, bt = { ...START, u: 0, v: 0, sog: 0, yawRate: 0 };
    let her = null;
    const F = createKayakFleet({ terrain: makeTerrain(), seed: 1, start: START, boat: () => ({ ...bt, x: bt.x + 400 }), heightAt: () => 0, hour: () => 9, wind: () => 1.5, tessie: () => (her ? { pts: her } : null) });
    const it = [...F.live.values()][0];
    return { F, it, a: it.a, set: (p) => { her = p; } };
  };
  const cam = (a) => ({ x: a.x, z: a.z + 30, fwdX: 0, fwdZ: -1, hHalf: 0.6 });
  let k = one(); let p = [k.a.x + Math.sin(k.a.heading) * 70, k.a.z - Math.cos(k.a.heading) * 70];
  k.set([p]); for (let i = 0; i < 60; i++) k.F.step(DT, cam(k.a));
  assert.equal(k.F.react(k.it.slot.id), null, 'no berth: 70 m off, it paddles on');
  k = one(); p = [k.a.x + Math.sin(k.a.heading) * 70, k.a.z - Math.cos(k.a.heading) * 70];
  assert.equal(k.F.berth(100), 100);
  k.set([p]); const d0 = Math.hypot(k.a.x - p[0], k.a.z - p[1]);
  for (let i = 0; i < 30 * 40; i++) k.F.step(DT, cam(k.a));   // the bow round with sweeps (about 15 s), then a cruise away (never a sprint)
  assert.equal(k.F.react(k.it.slot.id), 'away', 'berth 100 m: 70 m off, it paddles away');
  assert.ok(Math.hypot(k.a.x - p[0], k.a.z - p[1]) > d0 + 10, `away from her water (${d0.toFixed(0)} → ${Math.hypot(k.a.x - p[0], k.a.z - p[1]).toFixed(0)} m)`);
  // the player sets the berth by her level while she is played, and clears it when she goes back
  const calls = [], F = { berthM: 0, berth(m) { calls.push(m); this.berthM = m; return m; }, marks: () => [], spook() {}, lure: () => [] };
  const r6 = rig({ storage: atXp(100), at: { x: 2000, z: 2000 }, kayaks: () => F });
  r6.step(0.2); assert.equal(F.berthM, 100, 'level 6: 100 m');
  r6.P.back({ cut: true }); r6.step(0.1); assert.equal(F.berthM, 0, 'back in the boat: off');
  const F5 = { ...F, berthM: 0, berth(m) { this.berthM = m; return m; } };
  const r5 = rig({ storage: atXp(70), at: { x: 2000, z: 2000 }, kayaks: () => F5 });
  r5.step(0.2); assert.equal(F5.berthM, 0, 'level 5: no berth');
});

test('the chatter lines (level 6+): a boat\'s first sighting asks the line once; never at level 5, never under ?chatter=0', () => {
  const run = (xp, chatter = () => true) => {
    const world = lake(), b = world.L.liveBoats[0], q = b.phys.state, at = { x: q.x + 30, z: q.z };
    const r = rig({ storage: atXp(xp), at, world, chatter });
    world.L.lay(b.id, { x: at.x + 40, z: at.z, heading: 0 });
    r.step(0.5);
    return r.P.stats();
  };
  const s6 = run(100);
  assert.ok(s6.log.chatter, 'level 6: asked'); assert.ok(s6.rpg.waiting.includes(s6.log.chatter.kind), 'waiting for the skipper\'s line');
  assert.equal(run(70).log.chatter, undefined, 'level 5: no chatter');
  assert.equal(run(100, () => false).log.chatter, undefined, '?chatter=0: none');
});

test('level 13: the Halcyon\'s skipper flees at the first ring (a rank 4 Lure no longer turns him); level 12 still lures him', () => {
  const lured = (xp) => {
    const probe = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample: () => ({ vx: 0, vz: 0 }) }, headless: true });
    const r = rig({ storage: atXp(xp), at: { x: probe.state.x + 150, z: probe.state.z } });   // 150 m off the Halcyon
    r.step(0.1);
    r.P.pressSlot('lure');
    return r.P.stats().log.lure;
  };
  const l12 = lured(400), l13 = lured(450);   // level 12 starts at 385 XP, level 13 at 450
  assert.ok(l12.ids.includes('halcyon'), `below 13 the rank 4 Lure turns him (${JSON.stringify(l12.ids)})`);
  assert.ok(!l13.ids.includes('halcyon'), `13: he flees instead (${JSON.stringify(l13.ids)})`);
});

test('a boat at anchor: a target only under the RPG; knocked down (over to 62°, righting), scored as \'still\' (2 XP, ×3 the first)', () => {
  // the pure knockdown
  assert.equal(knockHeel(0), 0); assert.ok(Math.abs(knockHeel(ANCHORED.knock.inS + 1) - 62 * DEG) < 1e-9); assert.equal(knockHeel(60), null);
  const AB = createAnchoredBoats([{ id: 'anc-a', at: [2100, 2000], phase: 0.3 }], { depthAt: deep });
  AB.post({ x: 0, z: 0, heading: 0, u: 0, v: 0, yawRate: 0 }, DT, 0, () => WIND_FROM);
  assert.deepEqual(AB.targets().map((e) => [e.id, e.kind]), [['anc-a', 'anchored']]);
  assert.equal(hitRule('anchored'), 'knock'); assert.equal(BOUNTY_KIND.anchored, 'still'); assert.equal(hitRule('still'), null, 'a moored decoration stays out');
  // the hit tests see it as a target
  const e = AB.targets()[0], H = createTessieHits();
  assert.equal(H.aim({ x: e.x + Math.sin(e.heading) * 30, z: e.z - Math.cos(e.heading) * 30, psi: wrap(e.heading + Math.PI) }, [e], 0)?.id, 'anc-a');
  // as her: the chase pin swims at it and bites; the knockdown and the score
  const r = rig({ storage: atXp(70), at: { x: e.x + 40, z: e.z }, heading: -Math.PI / 2, anchored: () => AB });
  r.P.pin({ nose: 0, chase: 'anc-a' });
  let maxHeel = 0;
  const hit = r.step(25, () => { maxHeel = Math.max(maxHeel, Math.abs(AB.boats[0].kheel)); return r.P.stats().log.bounty.some((x) => x.kind === 'still'); });
  assert.ok(hit, `bitten and scored (${JSON.stringify(r.P.stats().log.lastContact)})`);
  const sc = r.P.stats().log.bounty.find((x) => x.kind === 'still');
  assert.equal(sc.first, true); assert.ok(sc.xp >= 6, `2 × 3 the first (× the multipliers): ${sc.xp}`);
  assert.equal(r.P.bounty.state().byType.still.wrecked, 1);
  assert.equal(AB.targets().length, 0, 'knocked down: no target while it lies over');
  r.step(3); maxHeel = Math.max(maxHeel, Math.abs(AB.boats[0].kheel));
  assert.ok(maxHeel > 55 * DEG, `over hard (${(maxHeel / DEG).toFixed(0)}°)`);
  r.P.pin(null);
  r.step(15);
  assert.equal(AB.boats[0].kheel, 0, 'righted on her rode'); assert.equal(AB.targets().length, 1);
  // the flag off: the same boat is no target (the player never lists it)
  const AB2 = createAnchoredBoats([{ id: 'anc-b', at: [2100, 2000], phase: 0.3 }], { depthAt: deep });
  assert.equal(AB2.boats[0].kheel, 0, 'a fresh boat draws with no added heel');
});

test('a Regatta rival listed by a race\'s source is a target: knocked by its own knock, 5 XP (×3 the first); the paddle-wheeler\'s splash scores 10', () => {
  const world = lake();
  const knocks = [];
  const rival = { id: 'r1', x: 2040, z: 2000, heading: Math.PI / 2, u: 0, knock: (side) => { knocks.push(side); return true; } };
  const r = rig({ storage: atXp(70), at: { x: 2000, z: 2000 }, heading: Math.PI / 2, world, rivals: () => (knocks.length ? [] : [rival]) });
  r.P.pin({ nose: 0, chase: 'r1' });
  assert.ok(r.step(25, () => knocks.length > 0), 'bitten');
  const sc = r.P.stats().log.bounty.find((x) => x.kind === 'rival');
  assert.ok(sc && sc.first && sc.xp >= 15, `scored as a rival: ${JSON.stringify(sc)}`);
  // the paddle-wheeler: her decks splashed (counted as splashed), 10 XP, ×3 the first
  const s = blankSave();
  const p = scoreInto(s, { kind: 'paddle', splash: true, depthM: 1 });
  assert.equal(p.xp, 30); assert.equal(s.byType.paddle.splashed, 1); assert.equal(s.byType.paddle.wrecked, 0);
  assert.equal(TYPES.find((t) => t.id === 'paddle').live, true);
  const hits = [];
  const paddle = { targets: () => [{ id: 'paddle', kind: 'paddle', x: 2060, z: 2000, heading: 0, u: 0, L: 42, B: 10 }], hit: (id, rule) => { hits.push(rule); return rule === 'splash'; } };
  const r2 = rig({ storage: atXp(70), at: { x: 2000, z: 2000 }, heading: Math.PI / 2, traffic: () => [paddle] });
  r2.P.pin({ nose: 0, chase: 'paddle' });
  assert.ok(r2.step(25, () => hits.length > 0), 'reached and bitten');
  const sp = r2.P.stats().log.bounty.find((x) => x.kind === 'paddle');
  assert.ok(sp && sp.splash && sp.xp >= 30, `scored as the paddle-wheeler, splashed: ${JSON.stringify(sp)}`);
});

test('a set completed: + 25 XP once, its legend line asked once on the skipper\'s line; the Logbook rows by set', () => {
  // the pure set
  const s = blankSave();
  for (const k of ['paddle', 'kayak', 'runabout', 'jetski']) scoreInto(s, { kind: k, splash: k !== 'runabout' });
  assert.deepEqual(setProgress(s, SETS[1]), { got: 4, of: 5, done: false });
  const xp0 = s.xp, r = scoreInto(s, { kind: 'still', depthM: 1 });
  assert.equal(r.set, 'south'); assert.equal(r.xp, 2 * 3 + BOUNTY.set, 'the first anchored boat (6) + the set (25)');
  assert.equal(s.xp, xp0 + 31);
  const again = scoreInto(s, { kind: 'still', depthM: 1 });
  assert.equal(again.set, null); assert.equal(again.xp, 2, 'the set pays once');
  // as her: the anchored boat that completes South Lake asks its legend line once
  const st = memStore({ [BOUNTY.key]: JSON.stringify({ _v: BOUNTY.v, xp: 70, ranks: { dash: 1 }, byType: Object.fromEntries(['paddle', 'kayak', 'runabout', 'jetski'].map((k) => [k, { wrecked: 0, splashed: 1 }])) }) });
  const AB = createAnchoredBoats([{ id: 'anc-a', at: [2100, 2000], phase: 0.3 }], { depthAt: deep });
  AB.post({ x: 0, z: 0, heading: 0, u: 0, v: 0, yawRate: 0 }, DT, 0, () => WIND_FROM);
  const e = AB.targets()[0];
  const rg = rig({ storage: st, at: { x: e.x + 40, z: e.z }, heading: -Math.PI / 2, anchored: () => AB });
  rg.P.pin({ nose: 0, chase: 'anc-a' });
  assert.ok(rg.step(25, () => rg.P.stats().log.bounty.some((x) => x.kind === 'still')), 'bitten');
  const S1 = rg.P.stats();
  assert.deepEqual(S1.log.sets.map((x) => x.id), ['south']);
  assert.ok(S1.rpg.waiting.includes('tip.tessie.legend.south'), 'the legend line waits for the skipper\'s line');
  assert.deepEqual(rg.P.bounty.state().sets, ['south']);
  // the Logbook: the South Lake view says the set is complete, with its line
  const v = tessiePage({ bounty: rg.P.bounty, mark: '' }).views().find((x) => x.id === 'south');
  assert.match(v.label, /set complete/);
  assert.deepEqual(v.rows.at(-1), { id: 'set', t: `◆ Set complete · +${BOUNTY.set} XP`, g: 'The paddle-wheeler changed its route.', got: true });
});

test('the save: a phase 1–3 save (no anchored, rival or paddle rows) reads whole; no point lost; the shape is unchanged', () => {
  const old = { _v: 2, xp: 340, ranks: { dash: 2, lure: 1 }, trials: { lure: 5, sonar: 3, surge: 5, breach: 5 }, sets: [],
    byType: { sail: { wrecked: 9, splashed: 0, first: '2026-11-24', deepestM: 9.4, unseen: 2, fastestS: null }, kayak: { wrecked: 0, splashed: 3 } } };
  const { save, migrated } = migrate(JSON.stringify(old), null);
  assert.equal(migrated, false, 'the same _v: no migration needed');
  assert.equal(save.xp, 340); assert.equal(save.level, 11); assert.equal(save.points, 10 - 2, 'level 11: 10 earned, 2 spent');
  assert.deepEqual(save.byType.sail, old.byType.sail);
  for (const k of ['rival', 'still', 'paddle']) assert.deepEqual(save.byType[k], { wrecked: 0, splashed: 0, first: null, deepestM: null, unseen: 0, fastestS: null });
  const T = createTessieBounty({ storage: memStore({ [BOUNTY.key]: JSON.stringify(old) }) });
  T.score({ kind: 'still', depthM: 2 });
  const s2 = T.state();
  assert.equal(s2.xp, 346); assert.equal(s2.points, save.points, 'nothing lost'); assert.equal(s2.byType.sail.wrecked, 9);
  assert.deepEqual(normalise(JSON.parse(JSON.stringify(s2))), s2, 'the round trip');
});
