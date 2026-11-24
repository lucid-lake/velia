// Kayak lanes, round B (owner, 2026-11-21: "start round B"; "tessie can attack kayak"). Behaviour only.
//   the launch spots: real put-ins on the chart, on water 6–15 m off the shore
//   the launch rule: after 180 s with no kayaker within 150 m (never before, never while the busy lake stands down), from a spot 150–500 m
//   ahead and out of the camera's view, a pair whose line crosses the course 80–200 m ahead of the player; at most 2 pairs a region
//   in the fleet: the launched pair meets the boat, and leaves only home again, out of the view and far
//   the kayakers and Tessie: within 40 m they stop and turn to watch her; within 15 m they back away; past 40 m they paddle on
//   her bite: the kayak over, the paddler in the water beside it, waiting 20–40 s out of her reach, then righted and paddling away
//   the bite's contact: her jaw on the kayak's hull (a kayak's own limits), not the water beside it; a pair is two targets
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { LAUNCH, LAUNCH_SPOTS, planLaunch, createLauncher, inView } from '../living/kayakLaunch.js';
import { REGIONS, residentKayaks } from '../living/busyLake.js';
import { createKayakFleet, TESSIE_REACT } from '../sim/kayaks.js';
import { createTessieHits, hullDist } from '../sim/tessieHits.js';
import { contactPoint } from '../sim/tessiePlay.js';
import { lakeTerrain } from '../sim/lake.js';
import { makeTerrain } from './helpers/ground.mjs';
import { polyline } from '../../src/sim/kayaks/routes.js';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { birthplaceRows } from '../sim/regions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);   // the region table's birthplaces (v2/sim/regions.js)
let chartC = null;
const chart = () => (chartC ??= planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(resolve(ROOT, 'v2/ui/planChart.bin'))))), chartInputs(JSON.parse(readFileSync(resolve(ROOT, 'v2/cruise/chartWorld.json'), 'utf8')))));
const isWater = (x, z) => chart().depthAt(x, z) > 0.5;
const DEG = Math.PI / 180;
// the camera 12 m behind the boat, looking along her heading (the probe's)
const camOf = (b, hHalf = 0.6) => ({ x: b.x - Math.sin(b.heading) * 12, z: b.z + Math.cos(b.heading) * 12, fwdX: Math.sin(b.heading), fwdZ: -Math.cos(b.heading), hHalf });

test('the launch spots: on water, 6–15 m off the shore, in their region', () => {
  for (const [rid, spots] of Object.entries(LAUNCH_SPOTS)) {
    const r = REGIONS.find((q) => q.id === rid); assert.ok(r, rid);
    for (const s of spots) {
      const [x, z] = s.at, d = chart().depthAt(x, z), sh = chart().shoreAt(x, z);
      assert.ok(d > 0.5, `${s.id} on water (${d.toFixed(1)} m)`);
      assert.ok(sh >= 5 && sh <= 20, `${s.id} at the shore (${sh.toFixed(1)} m off)`);
      assert.ok(Math.hypot(x - r.centre[0], z - r.centre[1]) <= r.radiusM, `${s.id} in ${rid}`);
    }
  }
});

test('the plan: a spot 150–500 m ahead, out of the view, a line on water crossing the course 80–200 m ahead', () => {
  // inbound from the open lake (one of round A's two weak courses) and across the mouth
  const regionAt = createLauncher({ regions: REGIONS }).regionAt;
  const cases = [{ x: 1900, z: -1500, heading: Math.atan2(1260 - 1900, -(-930 + 1500)), sog: 3 },
    { x: 1200, z: -900, heading: Math.atan2(760 - 1200, -(-650 + 900)), sog: 3 },
    { x: 2300, z: -1400, heading: Math.atan2(2650 - 2300, -(-1150 + 1400)), sog: 2.5 },
    { x: 1000, z: -900, heading: 90 * DEG, sog: 1.0 }];   // a slow boat (or Tessie) across the bay toward the channel
  let n = 0, spotStart = 0;
  for (const c of cases) {
    const cam = camOf(c), plan = planLaunch({ player: c, cam, spots: LAUNCH_SPOTS[regionAt(c.x, c.z)], isWater });
    if (!plan) continue;
    n++;
    // it appears at the spot, or on its line from the spot (set off earlier), 150–500 m ahead and out of the view
    const [px, pz] = plan.start, d = Math.hypot(px - c.x, pz - c.z);
    if (!plan.head) { spotStart++; assert.deepEqual(plan.start, plan.spot.at); }
    const [lx, lz] = plan.spot.at, [qx, qz] = plan.cross, along0 = ((px - lx) * (qx - lx) + (pz - lz) * (qz - lz)) / Math.hypot(qx - lx, qz - lz) ** 2;
    assert.ok(Math.abs(Math.hypot(px - lx, pz - lz) - along0 * Math.hypot(qx - lx, qz - lz)) < 0.5 && along0 >= 0 && along0 <= 1, 'on its line from the spot');
    assert.ok(d >= 150 && d <= 500, `appears ${d.toFixed(0)} m off`);
    assert.ok((px - c.x) * Math.sin(c.heading) - (pz - c.z) * Math.cos(c.heading) > 0, 'ahead of her');
    const v = inView(cam, px, pz); assert.ok(!v.cone || v.d >= LAUNCH.clearM, 'never pops up in the view');
    // the crossing: on her course line, and the pair there while she is still 80–200 m short of it
    const [cx, cz] = plan.cross, along = (cx - c.x) * Math.sin(c.heading) - (cz - c.z) * Math.cos(c.heading), across = (cx - c.x) * Math.cos(c.heading) + (cz - c.z) * Math.sin(c.heading);
    assert.ok(Math.abs(across) < 1, 'on her course');
    const gap = along - Math.max(LAUNCH.minBoatMs, c.sog) * Math.hypot(cx - px, cz - pz) / LAUNCH.vk;
    assert.ok(gap >= 80 && gap <= 200, `crosses ${gap.toFixed(0)} m ahead`);
    // the loop on water, and over the course line (its far point on the other side)
    for (let i = 0; i < plan.lane.length; i++) { const p = plan.lane[i], q = plan.lane[(i + 1) % plan.lane.length]; for (let u = 0; u <= 1; u += 0.05) assert.ok(isWater(p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u), 'on water'); }
    const sideOf = (p) => Math.sign((p[0] - c.x) * Math.cos(c.heading) + (p[1] - c.z) * Math.sin(c.heading));
    assert.notEqual(sideOf(plan.lane[0]), sideOf(plan.lane[2]), 'it crosses her course');
  }
  assert.ok(n >= 3, `planned ${n}/4`);
  assert.ok(spotStart >= 1, 'a slow player: a push-off from the spot itself, out of the view');
});

test('the rule: after 180 s unseen, not before; held while standing down; reset by a kayaker near; at most 2 pairs a region', () => {
  const L = createLauncher({ regions: REGIONS, isWater, polyline, seed: 1 });
  const p = { x: 1000, z: -900, heading: 90 * DEG, sog: 1.0 };   // its pose held: the plan's the same each try
  const cam = camOf(p);
  let out = null, t = 0;
  for (; t < 120; t += 0.5) assert.equal(L.tick(0.5, { player: p, cam, marks: [], allow: false }), null, 'standing down: nothing');
  assert.equal(L.unseen, 0, 'the clock held while standing down');
  for (t = 0; t < 179; t += 0.5) assert.equal(L.tick(0.5, { player: p, cam, marks: [] }), null, `nothing at ${t} s`);
  L.tick(0.5, { player: p, cam, marks: [{ x: p.x + 100, z: p.z }] });   // a kayaker 100 m off: the clock starts again
  assert.equal(L.unseen, 0);
  for (t = 0; t < 185 && !out; t += 0.5) out = L.tick(0.5, { player: p, cam, marks: [] });
  assert.ok(out && t >= 180, `launched at ${t} s`);
  assert.equal(out.length, 2, 'a pair'); assert.equal(out[0].group, out[1].group);
  assert.ok(out.every((s) => s.launched && s.region === 'emerald-bay'));
  // two pairs alive in the region: no third
  // (her region's and its neighbour's: the channel joins the bay and the open lake)
  const alive = ['tahoe-west', 'emerald-bay'].flatMap((region) => ['a', 'b'].map((g) => ({ x: 0, z: 0, launched: true, region, group: region + g })));
  let third = null;
  for (t = 0; t < 400; t += 0.5) third = third ?? L.tick(0.5, { player: p, cam, marks: alive.map((m) => ({ ...m, x: 5000 })) });
  assert.equal(third, null, 'at most 2 launched pairs a region');
});

// the probe's world: v1's lake terrain on the chart, the regions' kayakers, a boat on a straight course
function lakeWorld(course, { seed = 1, hour = 13 } = {}) {
  const terrain = lakeTerrain({ height: (x, z) => -chart().depthAt(x, z), distance: (x, z) => -chart().shoreAt(x, z) });
  const slots = residentKayaks(REGIONS, BIRTHPLACES, { seed, hour, polyline });
  const b = { x: course[0][0], z: course[0][1], heading: Math.atan2(course[1][0] - course[0][0], -(course[1][1] - course[0][1])), u: 2.2, v: 0, sog: 2.2, yawRate: 0 };
  const F = createKayakFleet({ terrain, seed, boat: () => b, hour: () => hour, residents: slots, dayOff: true, launcher: createLauncher({ regions: REGIONS, isWater: (x, z) => terrain.heightAt(x, z) < -0.5, polyline, seed }) });
  return { F, b };
}

test('in the fleet: the launched pair meets the boat on a weak course, and stays until home and far', () => {
  // inbound from the open lake into the bay (round A: 0.80 meetings per 3 min)
  const { F, b } = lakeWorld([[1900, -1500], [1260, -930]]);
  let launchedAt = null, ids = null, minD = Infinity;
  for (let t = 0; t < 320; t += 0.1) {
    b.x += Math.sin(b.heading) * b.sog * 0.1; b.z -= Math.cos(b.heading) * b.sog * 0.1;
    F.step(0.1, camOf(b));
    if (!ids && F.launched.size) { launchedAt = t; ids = [...F.launched.keys()]; }
    if (ids) for (const id of ids) { const it = F.live.get(id); if (it) minD = Math.min(minD, Math.hypot(it.a.x - b.x, it.a.z - b.z)); }
  }
  assert.ok(launchedAt != null && launchedAt >= 175, `launched at ${launchedAt?.toFixed(0)} s (the residents' meetings first reset the clock)`);
  assert.ok(minD <= LAUNCH.seenM, `the pair passed ${minD.toFixed(0)} m off`);
  assert.ok(ids.every((id) => F.live.has(id)), 'still out (not home and far yet)');
});

// a kayaker of v1's fleet (the tessie-hits test's), with Tessie's parts at a chosen place
function oneKayak() {
  const START = { x: 1200, z: -1050, heading: 251 * DEG }, bt = { ...START, u: 0, v: 0, sog: 0, yawRate: 0 };
  let her = null;
  const F = createKayakFleet({ terrain: makeTerrain(), seed: 1, start: START, boat: () => ({ ...bt, x: bt.x + 400 }), heightAt: () => 0, hour: () => 9, wind: () => 1.5, tessie: () => (her ? { pts: her } : null) });
  const it = [...F.live.values()][0];
  return { F, it, a: it.a, set: (p) => { her = p; } };
}
const cam = (a) => ({ x: a.x, z: a.z + 30, fwdX: 0, fwdZ: -1, hHalf: 0.6 });
const offTo = (a, x, z) => Math.abs(Math.atan2(Math.sin(Math.atan2(x - a.x, -(z - a.z)) - a.heading), Math.cos(Math.atan2(x - a.x, -(z - a.z)) - a.heading))) / DEG;

test('the kayakers and Tessie: watch within 40 m, back away within 15 m, paddle on past 40 m', () => {
  // past 40 m: nothing
  let k = oneKayak(); const far = [k.a.x + 60, k.a.z];
  k.set([far]);
  for (let i = 0; i < 60; i++) k.F.step(1 / 30, cam(k.a));
  assert.equal(k.F.react(k.it.slot.id), null, 'paddles on at 60 m');
  // 30 m abeam: the paddle stops, the bow and the head come round to her
  k = oneKayak(); const s = [k.a.x + Math.cos(k.a.heading) * 30, k.a.z + Math.sin(k.a.heading) * 30];
  k.set([s]);
  for (let i = 0; i < 30 * 12; i++) k.F.step(1 / 30, cam(k.a));
  assert.equal(k.F.react(k.it.slot.id), 'watch');
  assert.ok(Math.abs(k.a.v) < 0.55 && k.a.intent.throttle <= 0, `the paddle stopped (${k.a.v.toFixed(2)} m/s: a sweep's way at most)`);
  assert.ok(offTo(k.a, s[0], s[1]) < TESSIE_REACT.turnDeg, `the bow turned to her (${offTo(k.a, s[0], s[1]).toFixed(0)}° off)`);
  assert.ok(k.a.look != null && Math.abs(k.a.look) < 60, 'the head on her');
  // 10 m: back strokes away from her, at a paddler's pace
  k = oneKayak(); const n = [k.a.x + Math.sin(k.a.heading) * 10, k.a.z - Math.cos(k.a.heading) * 10];
  k.set([n]);
  const d0 = Math.hypot(k.a.x - n[0], k.a.z - n[1]); let vMax = 0;
  for (let i = 0; i < 30 * 20; i++) { k.F.step(1 / 30, cam(k.a)); if (i > 60) vMax = Math.max(vMax, Math.abs(k.a.v)); }
  assert.equal(k.F.react(k.it.slot.id), 'back');
  assert.ok(Math.hypot(k.a.x - n[0], k.a.z - n[1]) > d0 + 3, 'backed away from her');
  assert.ok(vMax < 1.4, `back strokes, no sprint (${vMax.toFixed(2)} m/s)`);
  // she dives (gone): the watch ends a few seconds later
  k.set(null);
  for (let i = 0; i < 30 * 15; i++) k.F.step(1 / 30, cam(k.a));
  assert.equal(k.F.react(k.it.slot.id), null, 'then paddles on');
});

test('her bite: over, the paddler beside it, 20–40 s out of her reach, righted, back in and paddling away', () => {
  const k = oneKayak(), id = k.it.slot.id, R = k.it.R;
  const at = [k.a.x + Math.cos(k.a.heading) * 1.2, k.a.z + Math.sin(k.a.heading) * 1.2];   // on its starboard side
  k.set([at]);
  assert.equal(k.F.bite(id, { x: at[0], z: at[1] }), true);
  assert.equal(k.F.bite(id, { x: at[0], z: at[1] }), false, 'once: a capsized kayak is no target');
  let t = 0, over = null, inWater = 0, rightAt = null, upAt = null, phiMin = 0, sw = null, splash = 0;
  const sfx = [];
  for (; t < 70; t += 1 / 30) {
    if (t > 12) k.set([[at[0] + 60, at[1]]]);   // she swims off after 12 s (the wait counts only from then)
    k.F.step(1 / 30, cam(k.a));
    sfx.push(...k.F.sfx.map((e) => e.type)); splash += k.F.splash.length;
    phiMin = Math.min(phiMin, R.phi);
    if (R.capsizes && over == null) over = t;
    if (R.sw.vis) { inWater = t; sw = sw ?? Math.hypot(R.sw.off, R.sw.fz); }
    if (R.mode === 'right' && rightAt == null) rightAt = t;
    if (over != null && R.mode === 'up' && upAt == null) upAt = t;
  }
  assert.ok(over != null && over < 2, `over at ${over?.toFixed(1)} s`);
  assert.ok(phiMin < -90 * DEG, 'rolled away from her (her starboard side up)');
  assert.ok(sfx.includes('capsize') && sfx.includes('righted'), `the splash's sounds (${[...new Set(sfx)]})`);
  assert.ok(splash > 0, 'water thrown up');
  assert.ok(sw != null && sw < 1.5, 'the paddler in the water beside it');
  const wait = rightAt - 12;   // her reach left at 12 s
  assert.ok(rightAt > 12 + 19 && wait <= 41, `righted ${wait.toFixed(1)} s after she left`);
  assert.ok(upAt != null && upAt > rightAt, 'back in and paddling');
  assert.equal(k.F.stats().capsizes.at(-1).byTessie, true);
  assert.equal(k.F.stats().lines.some((l) => l.kind === 'capsize'), false, 'no skipper line: the boat did nothing');
  // paddling away from her (her last place), at a cruise
  const d1 = Math.hypot(k.a.x - at[0], k.a.z - at[1]);
  const k2 = k; let vMax = 0;
  for (let i = 0; i < 30 * 10; i++) { k2.F.step(1 / 30, cam(k2.a)); vMax = Math.max(vMax, Math.abs(k2.a.v)); }
  assert.ok(Math.hypot(k.a.x - at[0], k.a.z - at[1]) > d1 + 3, 'paddles away from where she bit');
  assert.ok(vMax < 1.6, `no sprint (${vMax.toFixed(2)} m/s)`);
});

test('her bite stays held while she lingers near', () => {
  const k = oneKayak(), R = k.it.R, at = [k.a.x + 2, k.a.z];
  k.set([at]); k.F.bite(k.it.slot.id, { x: at[0], z: at[1] });
  for (let t = 0; t < 50; t += 1 / 30) { k.set([[k.a.x + 5, k.a.z]]); k.F.step(1 / 30, cam(k.a)); }
  assert.ok(R.busy && R.mode !== 'right' && R.mode !== 'climb', `still waiting with her 5 m off (${R.mode})`);
});

test('the bite\'s contact: her jaw on a kayak\'s hull, not the water beside it; a pair is two targets', () => {
  const H = createTessieHits();
  const k1 = { id: 'k:a', kind: 'kayak', x: 0, z: 0, heading: 0, L: 3.4, B: 0.85, bite: true }, k2 = { ...k1, id: 'k:b', z: 6 };
  // the aim point: on the gunwale, the deck's height, inside the hull's beam
  const cp = contactPoint(k1, 3, 0.5, 'rail');
  assert.ok(Math.abs(cp[0]) <= 0.43 && cp[1] < 0.4, `on the gunwale (${cp.map((v) => typeof v === 'number' ? v.toFixed(2) : v)})`);
  assert.ok(hullDist(cp[0], cp[2], k1) <= 0.01, 'on its skin');
  // her head 0.6 m off the side: a hit; 2.2 m off (the water beside it): a miss, locked or not
  assert.equal(H.contact({ x: 0.43 + 0.6, y: 0.2, z: 0, locked: false }, [k1], 0).hit?.id, 'k:a');
  const H2 = createTessieHits();
  assert.equal(H2.contact({ x: 0.43 + 2.2, y: 0.2, z: 0, locked: true, targetId: 'k:a' }, [k1], 0).hit, null);
  assert.equal(H2.contact({ x: 0.43 + 2.2, y: 0.2, z: 0, locked: false }, [k1], 0).hit, null);
  // a kayak without bite (the glass boat's, or capsized) is never a target
  assert.equal(createTessieHits().contact({ x: 0.6, y: 0, z: 0 }, [{ ...k1, bite: false }], 0).hit, null);
  // the pair: two targets; the lock takes the nearer, then the other once the first is in its grace
  const H3 = createTessieHits(), n = { x: -6, z: 4, psi: 90 * DEG };
  const lk = H3.lock(n, [k1, k2], 0, { dt: 0.1 });
  assert.equal(lk?.id, 'k:b', 'the nearer of the pair');
  H3.contact({ x: 0.6, y: 0, z: 6, locked: true, targetId: 'k:b' }, [k1, k2], 0);
  let id2 = null; for (let i = 1; i < 30; i++) id2 = H3.lock(n, [k1, k2], i * 0.1, { dt: 0.1 })?.id ?? id2;
  assert.equal(id2, 'k:a', 'then the other kayak');
});
