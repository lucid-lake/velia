// The busy lake (owner, 2026-11-18: "No staged kayaks at the opening ... stage a few different boats near the birthplace, but not staged
// by the birth camera angle — make it natural; it's a busy lake"; v2/living/busyLake.js): the per-seed schedule's determinism, the
// density round each birthplace at the first tick, no boat on a start spot or in the channel, the channel kept to starboard, the
// player kept clear of and softly bumpable, the stand-down in Regatta, the show and the night, the regions (a region with no birthplace
// never spawns; only the player's region and its neighbours are live), the routes on the chart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { steadyWind, BoatPhysics } from '../../src/sim/boat.js';
import { createBusyLake, spawnOf, activeRegions, regionsWithBirthplaces, evadeHeading, residentKayaks, birthLane, REGIONS, BUSY, BUSY_TIERS, KAYAK_BIRTH, KAYAK_LIFE } from '../living/busyLake.js';
import { birthPose } from '../sim/birthplace.js';
import { dayWind } from '../../src/sim/wind.js';
import { lakeTerrain } from '../sim/lake.js';
import { createTourBoat, birthPhase, routeLoop, pointAt } from '../sim/tourBoat.js';
import { createKayakFleet } from '../sim/kayaks.js';
import { polyline } from '../../src/sim/kayaks/routes.js';
import { ANCHORED_BOATS } from '../sim/anchoredBoats.js';
import { CHANNEL, channelAt } from '../terrain/channel.js';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { birthplaceRows } from '../sim/regions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);   // the region table's birthplaces (v2/sim/regions.js)
// the life rules (boats round each start, the glass boat in sight, a kayak pair within a minute) hold at the birthplaces of the
// regions that have life; a region before its lanes, put-ins and boats spends nothing. A region with a level of its own (South Lake) is
// not part of the bay's rules (the glass boat, the density round the start, the first pair in 60 s): its paddlers are checked in
// v2/tests/south-paddlers.test.mjs against the south level's bed
const LIFE = new Set(WATERS.regions.filter((r) => (r.boats?.length || r.kayaks?.length) && !r.level).map((r) => r.id));
const LIVE_BIRTHS = BIRTHPLACES.filter((b) => LIFE.has(b.region)), LIFE_REGIONS = REGIONS.filter((r) => LIFE.has(r.id));
let chartC = null;
const chart = () => (chartC ??= planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(resolve(ROOT, 'v2/ui/planChart.bin'))))), chartInputs(JSON.parse(readFileSync(resolve(ROOT, 'v2/cruise/chartWorld.json'), 'utf8')))));
const depthAt = (x, z) => chart().depthAt(x, z);
const ANCH = ANCHORED_BOATS.filter((a) => a.at).map((a) => ({ x: a.at[0], z: a.at[1] }));
const STARTS = [...BIRTHPLACES.map((b) => [b.x, b.z]), [WATERS.start.x, WATERS.start.z]];
const lake = (o = {}) => createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt, windAt: steadyWind(5, 225), tier: 'full', starts: [[WATERS.start.x, WATERS.start.z]], anchored: ANCH, ...o });
const still = (x, z) => ({ x, z, heading: 0, u: 0, v: 0, yawRate: 0 });
const at = (bp) => ({ eye: [bp.x, 2, bp.z], hour: 13 });

test('the schedule is deterministic per seed: the same seed lays and sails the same boats; another seed lays them elsewhere', () => {
  const run = (seed) => { const L = lake({ seed }), bp = BIRTHPLACES[0], S = still(bp.x, bp.z); for (let i = 0; i < 60 * 20; i++) L.post(S, 1 / 60, i / 60, at(bp)); return L.liveBoats.map((b) => [b.id, +b.phys.state.x.toFixed(6), +b.phys.state.z.toFixed(6), +b.phys.state.heading.toFixed(6)]); };
  const a = run(1), b = run(1), c = run(2);
  assert.ok(a.length >= 4, `${a.length} boats out`);
  assert.deepEqual(a, b, 'seed 1 twice');
  assert.notDeepEqual(a.map((r) => r.slice(0, 3)), c.map((r) => r.slice(0, 3)), 'seed 2 lays them elsewhere');
  // the spawn is a pure function of the seed (no clock, no Math.random)
  const row = REGIONS[0].boats[0];
  assert.deepEqual(spawnOf(row, 7, { windAt: steadyWind(5, 225), depthAt }), spawnOf(row, 7, { windAt: steadyWind(5, 225), depthAt }));
});

test('the density round each birthplace at the first tick: several boats out at 100 m to 1.5 km (a desktop 3 or more sailing, a tablet 3, a phone 1), none nearer than 250 m', () => {
  for (const [tier, want] of [['full', 3], ['lite', 3], ['phone', 1]]) for (const bp of LIVE_BIRTHS) for (const seed of [1, 2, 3, 4]) for (const wd of [45, 225]) {
    const L = lake({ seed, tier, windAt: steadyWind(5, wd) });
    L.post(still(bp.x, bp.z), 1 / 60, 0, at(bp));
    const ds = L.liveBoats.map((b) => Math.hypot(b.phys.state.x - bp.x, b.phys.state.z - bp.z));
    assert.ok(L.liveBoats.length <= BUSY_TIERS[tier].max, `${tier}: at most ${BUSY_TIERS[tier].max}`);
    assert.ok(ds.filter((d) => d >= 100 && d <= 1500).length >= want, `${tier} ${bp.id} seed ${seed} wind ${wd}: ${ds.map((d) => d.toFixed(0)).join(', ')} m`);
    assert.ok(ds.every((d) => d >= BUSY.spawnClearM - 1e-6), `${tier} ${bp.id} seed ${seed}: none on her start`);
  }
});

test('no boat starts on a start spot, near a boat at anchor, aground or in the entrance channel; each under way at the polar\'s speed', () => {
  for (const seed of [1, 2, 3, 5, 8, 13]) {
    const L = lake({ seed }), bp = BIRTHPLACES[0];
    L.post(still(bp.x, bp.z), 1 / 60, 0, at(bp));
    for (const b of L.liveBoats) {
      const s = b.spawn;
      for (const q of STARTS) assert.ok(Math.hypot(q[0] - s.x, q[1] - s.z) >= BUSY.spawnClearM, `${b.id} seed ${seed}: ${Math.hypot(q[0] - s.x, q[1] - s.z).toFixed(0)} m from a start`);
      for (const q of ANCH) assert.ok(Math.hypot(q.x - s.x, q.z - s.z) >= BUSY.spawnAnchoredM, `${b.id}: clear of the boats at anchor`);
      assert.ok(channelAt(s.x, s.z, CHANNEL).d >= BUSY.channelClearM, `${b.id} seed ${seed}: ${channelAt(s.x, s.z, CHANNEL).d.toFixed(0)} m off the channel's line`);
      assert.ok(depthAt(s.x, s.z) >= 4, `${b.id}: in ${depthAt(s.x, s.z).toFixed(1)} m`);
      assert.ok(s.speed > 1, `${b.id}: ${s.speed.toFixed(2)} m/s`);
    }
  }
});

test('a birthplace move (the player\'s boat jumps under the veil): no boat lies on her new spot', () => {
  for (const seed of [1, 2, 3]) {
    const L = lake({ seed }), [a, ...rest] = BIRTHPLACES;
    let S = still(a.x, a.z);
    for (let i = 0; i < 60 * 30; i++) L.post(S, 1 / 60, i / 60, at(a));
    for (const bp of rest) {
      S = still(bp.x, bp.z);
      L.post(S, 1 / 60, 40, at(bp));
      for (const b of L.liveBoats) assert.ok(Math.hypot(b.phys.state.x - bp.x, b.phys.state.z - bp.z) >= BUSY.spawnClearM, `seed ${seed}: ${b.id} on the ${bp.id} spot`);
    }
  }
});

test('the channel: a boat on her way out keeps to its starboard side and never sits on its centre line; motoring with the sails down when it lies to windward', () => {
  // the channel run alone, laid at the bay end; the wind from the lake (the channel's line dead to windward outbound)
  const regions = [{ id: 'emerald-bay', centre: [300, -400], radiusM: 1500, neighbours: [], boats: [{ id: 'ch', prio: 0, tint: '#ffffff', route: [[1000, -800], [1260, -930], [1690, -1350], [2250, -1700], [1690, -1350], [1260, -930]] }] }];
  const L = lake({ regions, seed: 3, windAt: steadyWind(5, 45) }), b = L.boats[0];
  const eye = { eye: [460, 2, -50], hour: 13 }, far = still(460, -50);   // the player still at Tessie's water (the regions follow her boat)
  L.post(far, 1 / 60, 0, eye);
  b.phys.state.x = 1180; b.phys.state.z = -890; b.sk.leg = 1;   // at the bay end, heading in
  let inCh = 0, starboard = 0, motoring = 0, bare = 0, minOff = Infinity;
  for (let i = 0; i < 60 * 260; i++) {
    L.post(far, 1 / 60, i / 60, eye);
    const s = b.phys.state, c = channelAt(s.x, s.z, CHANNEL);
    if (c.d < CHANNEL.coreHalfM && c.along > 60 && c.along < c.length - 60) {
      inCh++; minOff = Math.min(minOff, c.d);
      // starboard of the line going out (along rising): right of the line's direction
      const P = CHANNEL.pts; let k = 1; while (k < P.length - 1 && Math.hypot(P[k][0] - s.x, P[k][1] - s.z) > Math.hypot(P[k + 1][0] - s.x, P[k + 1][1] - s.z)) k++;
      const dx = P[k][0] - P[k - 1][0], dz = P[k][1] - P[k - 1][1], cross = (s.x - P[k - 1][0]) * dz - (s.z - P[k - 1][1]) * dx;
      if (cross < 0) starboard++;
      if (b.motoring) motoring++; if (b.bare) bare++;
    }
  }
  assert.ok(inCh > 60 * 30, `${(inCh / 60).toFixed(0)} s in the channel`);
  assert.ok(starboard / inCh > 0.8, `${(100 * starboard / inCh).toFixed(0)} % of it on her starboard side`);
  assert.ok(motoring / inCh > 0.8 && bare / inCh > 0.5, `motoring ${(100 * motoring / inCh).toFixed(0)} %, sails down ${(100 * bare / inCh).toFixed(0)} %`);
  assert.ok(minOff > 1, `${minOff.toFixed(1)} m off the centre line at the closest`);
});

test('the player is kept clear of: a boat sailing at her bears away well before; driven into one, a soft bump (no boat passes through)', () => {
  // the evasion's choice: a turn that opens the closest approach past the miss distance, never into the no-go cone
  const me = { x: 0, z: 0, heading: 0, u: 3 }, player = { x: 0, z: -120, heading: Math.PI, u: 3, m: 45 };
  const h = evadeHeading(me, 0, [player], 270 * Math.PI / 180);
  assert.ok(h != null && Math.abs(h) >= 10 * Math.PI / 180, 'she turns');
  // in the sim: the player's boat driven straight at each boat in turn for 60 s
  let worst = Infinity, evades = 0;
  for (const seed of [1, 2]) {
    const L = lake({ seed }), bp = BIRTHPLACES[0];
    L.post(still(bp.x, bp.z), 1 / 60, 0, at(bp));
    for (const target of L.liveBoats.slice(0, 3)) {
      if (!target.live) continue;
      const q = target.phys.state, back = 260;
      const S = { x: q.x + Math.sin(q.heading) * back, z: q.z - Math.cos(q.heading) * back, heading: q.heading + Math.PI, u: 2.8, v: 0, yawRate: 0 };   // head on, 260 m ahead of her
      const e0 = L.stats.evades;
      for (let i = 0; i < 60 * 60; i++) {
        S.x += Math.sin(S.heading) * S.u / 60; S.z -= Math.cos(S.heading) * S.u / 60;
        L.post(S, 1 / 60, 1 + i / 60, { eye: [S.x, 2, S.z], hour: 13 });
        if (target.live) worst = Math.min(worst, Math.hypot(S.x - target.phys.state.x, S.z - target.phys.state.z));
      }
      evades += L.stats.evades - e0;
    }
  }
  assert.ok(evades >= 3, `${evades} evasions`);
  assert.ok(worst > 25, `the closest any came: ${worst.toFixed(1)} m`);
  // a bump: the player's real hull driven into a boat lying still
  const L = lake({ seed: 1 }), bp = BIRTHPLACES[0];
  let bumps = 0;
  const L2 = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt, windAt: steadyWind(0.01, 225), tier: 'full', onBump: () => bumps++ });
  L2.post(still(bp.x, bp.z), 1 / 60, 0, at(bp));
  const t0 = L2.liveBoats[0], q0 = t0.phys.state;
  const P = new BoatPhysics({ x: q0.x - 20 * Math.cos(q0.heading), z: q0.z - 20 * Math.sin(q0.heading), heading: q0.heading + Math.PI / 2, speed: 1.5 });
  let minGap = Infinity;
  for (let i = 0; i < 60 * 20; i++) {
    const S = P.state; S.u = Math.max(S.u, 1.5); S.x += Math.sin(S.heading) * S.u / 60; S.z -= Math.cos(S.heading) * S.u / 60;
    L2.post(S, 1 / 60, 1 + i / 60, { eye: [S.x, 2, S.z], hour: 13 });
    minGap = Math.min(minGap, Math.hypot(S.x - t0.phys.state.x, S.z - t0.phys.state.z));
  }
  assert.ok(bumps >= 1 && L2.stats.contacts >= 1, `${bumps} bumps`);
  assert.ok(minGap > 1.2, `never through her (centres ${minGap.toFixed(2)} m apart at the closest)`);
  void L;
});

test('the glass boat and her kayaks: the lake\'s boats keep clear of them, and she yields to the lake\'s boats (rule 18)', async () => {
  // a lake boat sailing at a glass boat lying still on her course: she turns off it and passes well clear
  let worst = Infinity, evades = 0;
  for (const seed of [1, 2]) {
    const L = lake({ seed }), bp = BIRTHPLACES[0], S = still(bp.x, bp.z);
    L.post(S, 1 / 60, 0, at(bp));
    const b = L.liveBoats[0], q = b.phys.state;
    const g = { x: q.x + Math.sin(q.heading) * 200, z: q.z - Math.cos(q.heading) * 200, heading: q.heading + Math.PI / 2, u: 0, m: BUSY.avoid.tourM };
    const k = { x: g.x + 12, z: g.z, heading: 0, u: 0, m: BUSY.avoid.kayakM };
    const e0 = L.stats.evades;
    for (let i = 0; i < 60 * 120; i++) { L.post(S, 1 / 60, 1 + i / 60, { ...at(bp), others: [g, k] }); if (b.live) worst = Math.min(worst, Math.hypot(b.phys.state.x - g.x, b.phys.state.z - g.z)); }
    evades += L.stats.evades - e0;
  }
  assert.ok(evades >= 1, `${evades} evasions`);
  assert.ok(worst > 20, `the closest to the glass boat: ${worst.toFixed(1)} m`);
  // the glass boat with a sailboat dead ahead of her on her route: she slows (her yield), as she does for the player
  const { createTourBoat } = await import('../sim/tourBoat.js');
  const T = createTourBoat({ depthAt: () => 20, hour: 13, seed: 1 });
  for (let i = 0; i < 60 * 5; i++) T.post(null, 1 / 60, i / 60);
  const runFor = (others) => { const T2 = createTourBoat({ depthAt: () => 20, hour: 13, seed: 1 }); let y = 0; for (let i = 0; i < 60 * 40; i++) { if (i === 60 * 5 && T2.boat.mode === 'run') { const h = T2.boat.heading; T2.setOthers(others(T2, h)); } T2.post(null, 1 / 60, i / 60); if (T2.boat.yielding) y++; } return y; };
  const ahead = (T2, h) => [{ x: T2.boat.x + Math.sin(h) * 30, z: T2.boat.z - Math.cos(h) * 30 }];
  assert.equal(T.boat.mode, 'run', 'at 13:00 she is under way');
  assert.ok(runFor(ahead) > 0, 'she yields to a sailboat ahead');
  assert.equal(runFor(() => null), 0, 'and not with nobody about');
});

test('they stand down in Regatta, in the fireworks show and at night; they come back out of the eye\'s way', () => {
  const L = lake(), bp = BIRTHPLACES[0], S = still(bp.x, bp.z);
  L.post(S, 1 / 60, 0, at(bp));
  const n0 = L.liveBoats.length;
  assert.ok(n0 >= 4);
  L.post(S, 1 / 60, 1, { ...at(bp), race: true });
  assert.equal(L.liveBoats.length, 0, 'a race: none out'); assert.equal(L.active, false);
  for (let i = 0; i < 60 * 3; i++) L.post(S, 1 / 60, 2 + i / 60, at(bp));
  assert.ok(L.liveBoats.length >= 1, 'back after the race');
  for (const b of L.liveBoats) assert.ok(Math.hypot(b.phys.state.x - bp.x, b.phys.state.z - bp.z) >= BUSY.popM - 1e-6, `${b.id} rejoins ${BUSY.popM} m or more from the eye`);
  L.post(S, 1 / 60, 10, { ...at(bp), show: true });
  assert.equal(L.liveBoats.length, 0, 'the fireworks show: none out');
  const N = lake();
  N.post(S, 1 / 60, 0, { ...at(bp), hour: 21.5 });
  assert.equal(N.liveBoats.length, 0, 'at night the traffic is home');
});

test('regions: only the player\'s region and its neighbours are live; a region with no birthplace never spawns; adding one is a data row', () => {
  const live = regionsWithBirthplaces(REGIONS, BIRTHPLACES);
  assert.deepEqual(live.map((r) => r.id).sort(), [...new Set(BIRTHPLACES.map((b) => b.region))].sort(), 'every birthplace region has its traffic row');
  assert.deepEqual([...activeRegions(live, 460, -50)], ['emerald-bay', 'tahoe-west']);
  assert.deepEqual([...activeRegions(live, 2300, -1400)], ['tahoe-west', 'emerald-bay', 'south-lake']);
  assert.equal(activeRegions(live, 9000, 9000).size, 0, 'far from every region: nothing live');
  // a region in the data with no birthplace: never spawned, wherever the player is
  const extra = [...REGIONS, { id: 'nowhere', centre: [1000, 6000], radiusM: 2000, neighbours: [], boats: [{ id: 'ghost', prio: 0, tint: '#ffffff', route: [[1000, 6000], [1500, 6000]] }] }];
  const L = lake({ regions: extra });
  L.post(still(1000, 6000), 1 / 60, 0, { eye: [1000, 2, 6000], hour: 13 });
  assert.ok(!L.boats.some((b) => b.id === 'ghost'), 'no birthplace, no boats');
  assert.equal(L.liveBoats.length, 0, 'and none live out there');
  // a new birthplace region is a data step: its row and its birthplace
  const L2 = createBusyLake({ seed: 1, birthplaces: [...BIRTHPLACES, { id: 'x', x: 1100, z: 6000, region: 'nowhere' }], regions: extra, depthAt: () => 30, windAt: steadyWind(5, 225), tier: 'full' });
  L2.post(still(1100, 6400), 1 / 60, 0, { eye: [1100, 2, 6400], hour: 13 });
  assert.deepEqual(L2.liveBoats.map((b) => b.id), ['ghost']);
});

test('every route on the chart: each leg in 4 m of water or more and 80 m off the shore, so well clear of the emergent boulders at the waterline (v2/sim/bedBoulders.js: centres in -1.0..+0.4 m of water, radius up to 3.5 m) and outside every keep-out disc (the channel run\'s channel legs excepted)', () => {
  const C = chart();
  for (const r of REGIONS) for (const b of r.boats) {
    const R = b.route;
    for (const p of R) assert.ok(C.depthAt(p[0], p[1]) >= 4, `${b.id}: waypoint ${p} in ${C.depthAt(p[0], p[1]).toFixed(1)} m`);
    for (let i = 0; i < R.length; i++) {
      const a = R[i], c = R[(i + 1) % R.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (let d = 0; d <= L; d += 20) {
        const x = a[0] + (c[0] - a[0]) * d / L, z = a[1] + (c[1] - a[1]) * d / L;
        if (channelAt(x, z, CHANNEL).d < 60) continue;
        assert.ok(C.depthAt(x, z) >= 4 && C.shoreAt(x, z) >= 80, `${b.id} leg ${i}: (${x.toFixed(0)}, ${z.toFixed(0)}) ${C.depthAt(x, z).toFixed(1)} m deep, ${C.shoreAt(x, z).toFixed(0)} m off`);
        for (const [cx, cz, kr] of r.keepOut ?? []) assert.ok(Math.hypot(x - cx, z - cz) >= kr, `${b.id} leg ${i}: inside the keep-out at (${cx}, ${cz})`);
      }
    }
  }
});

// ---- the first birth and the rebirth (owner, 2026-11-19: "no matter where the boat is first born, the glass boat's loop and 1–3
// kayaks around each birthplace, so both are visible within a minute ... if the user is reborn at another place, it should be real")
const los = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0); for (let d = 20; d < L - 20; d += 20) if (!(depthAt(x0 + (x1 - x0) * d / L, z0 + (z1 - z0) * d / L) > 0.3)) return false; return true; };
const SEEN = Object.freeze({ glassM: 1000, kayakM: 600 });   // m: a 10.7 m pontoon and a 3.4 m kayak still read on screen this far, with a line of sight over water

test('the first birth: from every birthplace (default seed and two others) the glass boat is in sight within 60 s, underway or at a stop, never parked on the start', () => {
  for (const bp of LIVE_BIRTHS) for (const seed of [1, 2, 3]) {
    const tau = birthPhase(bp, { seed, los }), T = createTourBoat({ depthAt, tauS: tau, seed });
    const d0 = Math.hypot(T.boat.x - bp.x, T.boat.z - bp.z);
    let seen = Infinity;
    for (let i = 0; i <= 60 * 30; i++) { if (i) T.post(null, 1 / 30, i / 30, () => 240); if (i % 15) continue; const d = Math.hypot(T.boat.x - bp.x, T.boat.z - bp.z); if (d < seen && los(bp.x, bp.z, T.boat.x, T.boat.z)) seen = d; }
    assert.ok(d0 >= 150, `${bp.id} seed ${seed}: ${d0.toFixed(0)} m off the start at first`);
    assert.ok(seen <= SEEN.glassM, `${bp.id} seed ${seed}: in sight at ${seen.toFixed(0)} m within 60 s`);
  }
  // the seed varies her (natural), the same seed places her the same
  assert.equal(birthPhase(BIRTHPLACES[0], { seed: 5, los }), birthPhase(BIRTHPLACES[0], { seed: 5, los }));
  assert.notEqual(birthPhase(BIRTHPLACES[0], { seed: 1, los }), birthPhase(BIRTHPLACES[0], { seed: 2, los }));
});

test('the regions\' kayakers: every birthplace has a lane wholly in sight (600 m, a line of sight over water), in water off the shore, clear of the starts, the glass boat\'s route, the channel\'s fairway and the boats at anchor', () => {
  const C = chart(), loop = routeLoop(), tour = [];
  for (let s = 0; s < loop.length; s += 10) tour.push(pointAt(loop, s));
  const lanes = REGIONS.flatMap((r) => (r.kayaks ?? []).map((k) => ({ k, r, pts: (() => { const p = polyline(k.lane, true), o = []; for (let s = 0; s < p.length; s += 5) o.push(p.at(s)); return o; })() })));
  assert.ok(lanes.length >= LIVE_BIRTHS.length, `${lanes.length} kayakers`);
  // the sailboats' way (owner, 2026-11-21): busy, mostly pairs; a few per region, the fleet's cost small (renders/kayak-lanes/cost.mjs)
  for (const r of LIFE_REGIONS) {
    const n = residentKayaks([r], [{ region: r.id }], { seed: 1, hour: 13, polyline }).length, pairs = r.kayaks.filter((k) => k.mate).length;
    assert.ok(n >= 4 && n <= 10, `${r.id}: ${n} kayakers`);
    assert.ok(pairs * 2 >= n - pairs * 2, `${r.id}: at least half of them in pairs (${pairs} pairs of ${n} kayakers)`);
  }
  const anch = ANCHORED_BOATS.filter((a) => a.at);
  for (const { k, pts } of lanes) for (const q of pts) {
    assert.ok(C.depthAt(q.x, q.z) >= 1.5 && C.shoreAt(q.x, q.z) >= 15, `${k.id}: (${q.x.toFixed(0)}, ${q.z.toFixed(0)}) ${C.depthAt(q.x, q.z).toFixed(1)} m deep, ${C.shoreAt(q.x, q.z).toFixed(0)} m off`);
    for (const b of BIRTHPLACES) assert.ok(Math.hypot(b.x - q.x, b.z - q.z) >= 60, `${k.id}: off the ${b.id} start`);
    assert.ok(tour.every((t) => Math.hypot(t.x - q.x, t.z - q.z) >= 100), `${k.id}: off the glass boat's route`);
    assert.ok(channelAt(q.x, q.z, CHANNEL).d >= CHANNEL.coreHalfM + CHANNEL.sideM + 20, `${k.id}: out of the channel's fairway`);
    assert.ok(anch.every((a) => Math.hypot(a.at[0] - q.x, a.at[1] - q.z) >= 30), `${k.id}: clear of the boats at anchor`);
  }
  for (const b of LIVE_BIRTHS) {
    const whole = lanes.filter(({ pts }) => pts.every((q) => Math.hypot(b.x - q.x, b.z - q.z) <= SEEN.kayakM && los(b.x, b.z, q.x, q.z)));
    assert.ok(whole.length >= 1, `${b.id}: a kayaker always in sight (lanes: ${whole.map((l) => l.k.id).join(', ') || 'none'})`);
  }
  // the clock and the seed place them (a reload: a new place on the same lanes); the same twice
  const a = residentKayaks(REGIONS, BIRTHPLACES, { seed: 1, hour: 13, polyline, loaded: 'south-lake' }), b = residentKayaks(REGIONS, BIRTHPLACES, { seed: 1, hour: 13, polyline, loaded: 'south-lake' }), c = residentKayaks(REGIONS, BIRTHPLACES, { seed: 1, hour: 13.1, polyline, loaded: 'south-lake' });
  assert.deepEqual(a.map((s) => s.s0), b.map((s) => s.s0));
  assert.notDeepEqual(a.map((s) => s.s0), c.map((s) => s.s0), 'six minutes later: further along');
  assert.ok(a.every((s) => s.resident && !s.route.rests.length), 'they paddle (no rests)');
  // a pair: two kayakers of one group on one lane, the mate apartM behind (v1's mind keeps a group paddling together)
  for (const k of REGIONS.flatMap((r) => r.kayaks).filter((k) => k.mate)) {
    const two = a.filter((s) => s.route.id === k.id), L = two[0].route.path.length;
    assert.equal(two.length, 2, `${k.id}: a pair`);
    assert.ok(two.every((s) => s.group === k.id) && two[0].colour !== two[1].colour, `${k.id}: one group, two hulls`);
    assert.ok(Math.abs(((two[0].s0 - two[1].s0) % L + L) % L - KAYAK_LIFE.apartM) < 1e-6, `${k.id}: the mate ${KAYAK_LIFE.apartM} m behind`);
  }
  // a region with no birthplace owns none
  assert.equal(residentKayaks(REGIONS, BIRTHPLACES.filter((p) => p.region !== 'tahoe-west'), { seed: 1, hour: 13, polyline }).filter((s) => s.region === 'tahoe-west').length, 0);
});

test('the kayakers\' first birth: from every birthplace, whatever the wind, a pair passes 40–120 m off the boat\'s reach within 60 s (the rule\'s pair from ≥ 80 m, every kayaker ≥ 60 m at the start); fixed then, paddled on after', () => {
  // the rule (busyLake.js birthLane) for every wind and seed: a pair, in the band, from the pose alone
  for (const bp of LIVE_BIRTHS) for (let w = 0; w < 360; w += 30) for (const seed of [1, 2, 3]) {
    const pose = birthPose(bp, { windDeg: w, depthAt });
    const r = birthLane(REGIONS.find((g) => g.id === bp.region).kayaks, { x: bp.x, z: bp.z, headingDeg: pose.headingDeg, speed: pose.speed }, { seed, polyline });
    assert.ok(r && r.pair && r.dmin >= KAYAK_BIRTH.nearM[0] && r.dmin <= KAYAK_BIRTH.nearM[1], `${bp.id} wind ${w}° seed ${seed}: ${r ? `${r.id} ${r.dmin.toFixed(0)} m` : 'none'}`);
  }
  // in v1's fleet (its mind: the boat given way to, the pair together): the day's wind at 13:00, the boat on her reach, untouched
  const terrain = lakeTerrain({ height: (x, z) => -depthAt(x, z), distance: (x, z) => -chart().shoreAt(x, z) });
  for (const bp of LIVE_BIRTHS) for (const seed of [1, 2, 3]) {
    const pose = birthPose(bp, { windDeg: dayWind(13, { seed }).dirDeg, depthAt }), h = pose.headingDeg * Math.PI / 180;
    const birth = { x: bp.x, z: bp.z, headingDeg: pose.headingDeg, speed: pose.speed, region: bp.region, hour: 13 };
    const slots = residentKayaks(REGIONS, BIRTHPLACES, { seed, hour: 13, polyline, birth });
    const boat = { x: bp.x, z: bp.z, heading: h, u: pose.speed, v: 0, yawRate: 0, sog: pose.speed };
    const F = createKayakFleet({ terrain, seed, boat: () => boat, hour: () => 13, residents: slots, dayOff: true });
    let d0 = null, near = Infinity;
    for (let i = 0; i <= 30 * 60; i++) {
      if (i) { boat.x += Math.sin(h) * pose.speed / 30; boat.z -= Math.cos(h) * pose.speed / 30; }
      F.step(1 / 30, { x: boat.x - Math.sin(h) * 12, z: boat.z + Math.cos(h) * 12, fwdX: Math.sin(h), fwdZ: -Math.cos(h), hHalf: 0.6 });
      if (i % 15) continue;
      const d = Math.min(...F.marks().map((m) => Math.hypot(m.x - boat.x, m.z - boat.z)));
      if (d0 == null) d0 = d; near = Math.min(near, d);
    }
    assert.ok(d0 >= 60, `${bp.id} seed ${seed}: the nearest kayaker ${d0.toFixed(0)} m off at the start`);
    assert.ok(near <= KAYAK_BIRTH.nearM[1] && near >= 15, `${bp.id} seed ${seed}: the nearest pass ${near.toFixed(0)} m within 60 s`);
  }
  // fixed at the birth: the fleet made later finds the pair paddled on from there (never re-placed by the hour)
  const bp = BIRTHPLACES[0], birth = { x: bp.x, z: bp.z, headingDeg: 90, speed: 2.75, region: bp.region, hour: 13 };
  const s1 = residentKayaks(REGIONS, BIRTHPLACES, { seed: 1, hour: 13, polyline, birth }), s2 = residentKayaks(REGIONS, BIRTHPLACES, { seed: 1, hour: 13 + 40 / 3600, polyline, birth });
  const lane = birthLane(REGIONS[0].kayaks, birth, { seed: 1, polyline }), i = s1.findIndex((s) => s.id === lane.id), L = s1[i].route.path.length;
  assert.ok(Math.abs(((s2[i].s0 - s1[i].s0) % L + L) % L - 40 * KAYAK_LIFE.speedMs) < 1e-6, '40 s later: 50 m further along');
  assert.deepEqual(residentKayaks(REGIONS, BIRTHPLACES, { seed: 1, hour: 13, polyline, birth }).map((s) => s.s0), s1.map((s) => s.s0), 'the same birth twice');
});

test('a rebirth: nothing teleports — the glass boat and every kayaker move on continuously across the player\'s jump to another birthplace', () => {
  // the glass boat: her place moves by no more than her speed each tick while the player jumps from Tessie's water to the open lake
  const T = createTourBoat({ depthAt, tauS: 1200, seed: 1 });
  let S = still(BIRTHPLACES[0].x, BIRTHPLACES[0].z), prev = [T.boat.x, T.boat.z], worstT = 0;
  for (let i = 1; i <= 30 * 60; i++) {
    if (i === 30 * 20) S = still(2300, -1400);   // the move (the veil)
    T.post(S, 1 / 30, i / 30, () => 240);
    worstT = Math.max(worstT, Math.hypot(T.boat.x - prev[0], T.boat.z - prev[1]) - (T.boat.v + 0.5) / 30); prev = [T.boat.x, T.boat.z];
  }
  assert.ok(worstT < 0.05, `the glass boat's largest step past her speed: ${worstT.toFixed(3)} m`);
  // the kayakers (v1's fleet with the regions' residents, no day kayakers): out wherever the camera is when made, never moved with it
  const slots = residentKayaks(REGIONS, BIRTHPLACES, { seed: 1, hour: 13, polyline });
  let boat = { x: BIRTHPLACES[0].x, z: BIRTHPLACES[0].z, heading: 0, u: 0, v: 0, yawRate: 0, sog: 0 };
  const terrain = { shoreDistance: (x, z) => -chart().shoreAt(x, z) };
  const F = createKayakFleet({ terrain, seed: 1, boat: () => boat, hour: () => 13, residents: slots, dayOff: true });
  const cam = (b) => ({ x: b.x, z: b.z - 12, fwdX: 0, fwdZ: -1, hHalf: 0.6 });
  F.step(1 / 30, cam(boat));
  assert.equal(F.marks().length, slots.length, 'every region\'s kayakers out from the start, wherever the camera is');
  let prevK = F.marks(), worstK = 0;
  for (let i = 1; i <= 30 * 40; i++) {
    if (i === 30 * 15) boat = { ...boat, x: 2300, z: -1400 };   // the move
    F.step(1 / 30, cam(boat));
    const now = F.marks();
    assert.equal(now.length, prevK.length, 'none appears or leaves at the move');
    now.forEach((m, k) => { worstK = Math.max(worstK, Math.hypot(m.x - prevK[k].x, m.z - prevK[k].z)); });
    prevK = now;
  }
  assert.ok(worstK < 2.5 / 30 + 0.02, `a kayaker's largest step: ${worstK.toFixed(3)} m a tick`);
  assert.equal(F.again({ x: 0, z: 0, yaw: 0, hHalf: 0.6 }), null, 'no staged pair with the residents');
});
