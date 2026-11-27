// South Lake's traffic (phase C; v2/sim/paddleWheeler.js routed, v2/living/powerTraffic.js, v2/living/powerBoats.js,
// v2/render/smallCraft*.js, src/core/features.js paddleWheeler + powerBoats, v2/sim/tessieHits.js kinds): the paddle-wheeler met within
// 2 minutes of the Ski Run start and moving as a real boat; no contact with the player or a pier over a long run; deep water only; the
// region's loading (nothing new for a bay start but her); determinism by ?hour and ?seed; the Tessie kinds. Behaviour only.
// (The routes' 4 m / 80 m rule: v2/tests/busy-lake.test.mjs, 'every traffic route on the chart'.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createPaddleWheeler, paddleRoute, paddleBirthTau, pierDistance, PADDLE, PADDLE_RUN } from '../sim/paddleWheeler.js';
import { routeLoop } from '../sim/tourBoat.js';
import { createPowerTraffic, POWER, loopOfRow, roosterTail } from '../living/powerTraffic.js';
import { nearestVoice, powerGain } from '../living/powerBoats-sound.js';
import { buildCraft, buildCraftMeshes, SLOT, VF, lodFor, DRAW_M, JET } from '../render/smallCraftMesh.js';
import { createTessieHits, hitRule, HIT_RULE } from '../sim/tessieHits.js';
import { trafficOf, birthplaceRows } from '../sim/regions.js';
import { birthPose } from '../sim/birthplace.js';
import { dayWind } from '../../src/sim/wind.js';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createFeatures, POLICIES } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';
import { LAKE_PLUGINS } from '../living/lakePlugins.js';
import { budget } from '../../tests/helpers/budget.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const PIERS = JSON.parse(readFileSync(resolve(ROOT, 'v2/assets/towns/piers.json'), 'utf8')).piers;
let chartC = null;
const chart = () => (chartC ??= planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(resolve(ROOT, 'v2/ui/planChart.bin'))))), chartInputs(JSON.parse(readFileSync(resolve(ROOT, 'v2/cruise/chartWorld.json'), 'utf8')))));
const depthAt = (x, z) => chart().depthAt(x, z);
const PADDLE_ROW = trafficOf(WATERS, 'paddle')[0], ROUTE = paddleRoute(PADDLE_ROW);
const SKI = birthplaceRows(WATERS).find((b) => b.id === 'ski-run');
const KN = 0.514444, DEG = Math.PI / 180;
const poseAt = (hour, seed) => birthPose(SKI, { windDeg: dayWind(hour, { seed }).dirDeg, depthAt });
const still = (x, z, heading = 0) => ({ x, z, heading, u: 0, v: 0, yawRate: 0 });
// the distance between two hulls as oriented boxes (her L × B, the player's 8.5 × 3), sampled on the player's outline
const hullGap = (a, aL, aB, b, bL = 8.5, bB = 3) => {
  const fa = [Math.sin(a.heading), -Math.cos(a.heading)], fb = [Math.sin(b.heading), -Math.cos(b.heading)];
  let d = Infinity;
  for (let i = -4; i <= 4; i++) for (const s of [-1, 1]) {
    const px = b.x + fb[0] * (i / 4) * bL / 2 + -fb[1] * s * bB / 2, pz = b.z + fb[1] * (i / 4) * bL / 2 + fb[0] * s * bB / 2;
    const dx = px - a.x, dz = pz - a.z, al = Math.abs(dx * fa[0] + dz * fa[1]) - aL / 2, ac = Math.abs(-dx * fa[1] + dz * fa[0]) - aB / 2;
    d = Math.min(d, Math.hypot(Math.max(0, al), Math.max(0, ac)) + Math.min(0, Math.max(al, ac)));
  }
  return d;
};

// ---- the paddle-wheeler ----
test('her route: Ski Run\'s pier ↔ off Emerald Bay, about 21 km round with one stop off the pier head; 8 kn in open water, 4 kn on the slow legs; unnamed', () => {
  const loop = routeLoop(ROUTE);
  assert.ok(loop.length > 19000 && loop.length < 24000, `${loop.length.toFixed(0)} m`);
  assert.deepEqual(loop.stops.map((s) => s.id), ['pier']);
  const pier = loop.stops[0].at, head = [12196, 295];   // the pier's head (v2/assets/towns/piers.json)
  assert.ok(Math.hypot(pier[0] - head[0], pier[1] - head[1]) < 120, 'the stop sits off the pier head');
  const far = ROUTE.reduce((m, r) => Math.min(m, Math.hypot(r.at[0] - 1685, r.at[1] + 1270)), Infinity);
  assert.ok(far < 2200, `she turns within ${far.toFixed(0)} m of Emerald Bay's mouth`);
  assert.equal(PADDLE_RUN.fastKn, 8); assert.equal(PADDLE_RUN.speedKn, 4);
  assert.ok(!JSON.stringify(PADDLE_ROW).match(/Queen|Dixie|Rose|Zephyr/), 'no real vessel\'s name');
});

test('met within 2 minutes from the Ski Run start: at the morning and afternoon winds and three seeds she starts 300 m off or more and comes within 400 m of the player\'s reach (every speed he may make) inside 120 s', () => {
  const t0 = performance.now();
  for (const hour of [10, 15, 17.5]) for (const seed of [1, 7, 42]) {
    const pose = poseAt(hour, seed), birth = { x: pose.x, z: pose.z, headingDeg: pose.headingDeg, look: SKI.look };
    for (const u of [2, 3.25, 4.5]) {
      const S = createPaddleWheeler({ route: ROUTE, hour, seed, birth, depthAt });
      const h = pose.headingDeg * DEG, d0 = Math.hypot(S.boat.x - pose.x, S.boat.z - pose.z);
      assert.ok(d0 >= 300, `${hour} h seed ${seed}: she starts ${d0.toFixed(0)} m off`);
      let dmin = Infinity;
      for (let i = 1; i <= 120 * 10; i++) { S.post(0.1); const t = i * 0.1; dmin = Math.min(dmin, Math.hypot(S.boat.x - pose.x - Math.sin(h) * u * t, S.boat.z - pose.z + Math.cos(h) * u * t)); }
      assert.ok(dmin <= 400, `${hour} h seed ${seed} at ${u} m/s: nearest ${dmin.toFixed(0)} m in 2 minutes`);
    }
  }
  budget(performance.now() - t0, 4000, 'nine births, 27 two-minute runs');
});

test('the cheat is on when, not on motion: without the birth shift she is not met within 2 minutes; with it she runs at 8 kn or less, turns at 2.6°/s or less and eases her speed (no jumps)', () => {
  const pose = poseAt(15, 1), birth = { x: pose.x, z: pose.z, headingDeg: pose.headingDeg, look: SKI.look };
  const meet = (b) => { const S = createPaddleWheeler({ route: ROUTE, hour: 15, seed: 1, birth: b, depthAt }); let d = Infinity; for (let i = 0; i < 1200; i++) { S.post(0.1); d = Math.min(d, Math.hypot(S.boat.x - pose.x, S.boat.z - pose.z)); } return d; };
  assert.ok(meet(null) > 400, `no shift: nearest ${meet(null).toFixed(0)} m (the clock alone puts her elsewhere)`);
  const S = createPaddleWheeler({ route: ROUTE, hour: 15, seed: 1, birth, depthAt });
  let last = { h: S.boat.heading, v: S.boat.v }, vmax = 0, rmax = 0, amax = 0;
  for (let i = 0; i < 20 * 60 * 10; i++) {
    S.post(0.1);
    vmax = Math.max(vmax, S.boat.v);
    rmax = Math.max(rmax, Math.abs(Math.atan2(Math.sin(S.boat.heading - last.h), Math.cos(S.boat.heading - last.h))) / 0.1);
    amax = Math.max(amax, Math.abs(S.boat.v - last.v) / 0.1);
    last = { h: S.boat.heading, v: S.boat.v };
  }
  assert.ok(vmax <= 8 * KN + 1e-6, `top speed ${(vmax / KN).toFixed(2)} kn`);
  assert.ok(rmax <= PADDLE_RUN.yawRate * DEG + 1e-6, `turn ${(rmax / DEG).toFixed(2)}°/s`);
  assert.ok(amax <= PADDLE_RUN.decel * PADDLE_RUN.hardDecel + 1e-6, `speed change ${amax.toFixed(3)} m/s²`);
});

test('a whole round (about 100 minutes): deep water under her and her look ahead, never within 25 m of a pier, the stop off the pier head made and left', () => {
  const S = createPaddleWheeler({ route: ROUTE, hour: 12, seed: 3, depthAt, piers: PIERS });
  const T = S.timetable().period;
  let dmin = Infinity, pmin = Infinity, stops = 0, wasStop = S.boat.mode === 'stop';
  for (let t = 0; t < T + 60; t += 0.25) {
    S.post(0.25);
    const fx = Math.sin(S.boat.heading), fz = -Math.cos(S.boat.heading);
    for (const f of [-20, 0, 20]) dmin = Math.min(dmin, depthAt(S.boat.x + fx * f, S.boat.z + fz * f));
    pmin = Math.min(pmin, pierDistance(PIERS, S.boat.x, S.boat.z, 300) - PADDLE.beam / 2);
    if (S.boat.mode === 'stop' && !wasStop) stops++;
    wasStop = S.boat.mode === 'stop';
  }
  assert.ok(dmin >= 4, `the shallowest under her ${dmin.toFixed(1)} m`);
  assert.ok(pmin >= 25, `the nearest pier ${pmin.toFixed(0)} m off her side`);
  assert.ok(stops >= 1, 'she stopped at the pier and left again');
});

test('the player is kept clear of: parked on her course or crossing her bow, she slows, backs her wheel and bends away; her hull never touches his', () => {
  const loop = routeLoop(ROUTE);
  // parked on her line at six places round the route (open water, near the pier, the Emerald turn)
  for (const sAt of [800, 3000, 7500, 10500, 15000, loop.length - 300]) {
    const S = createPaddleWheeler({ route: ROUTE, hour: 12, seed: 1, depthAt, piers: PIERS });
    // lay her 600 m before the place on her own route, under way
    const s = (sAt - 600 + loop.length) % loop.length;
    const p0 = loop.seg.find((g) => s >= g.s0 && s <= g.s0 + g.L) ?? loop.seg[0], f0 = (s - p0.s0) / p0.L;
    Object.assign(S.boat, { x: p0.a[0] + (p0.b[0] - p0.a[0]) * f0, z: p0.a[1] + (p0.b[1] - p0.a[1]) * f0, heading: Math.atan2(p0.b[0] - p0.a[0], -(p0.b[1] - p0.a[1])), v: 8 * KN, s, mode: 'run' });
    const sg = loop.seg.find((g) => sAt >= g.s0 && sAt <= g.s0 + g.L) ?? loop.seg[0], fg = (sAt - sg.s0) / sg.L;
    const P = still(sg.a[0] + (sg.b[0] - sg.a[0]) * fg, sg.a[1] + (sg.b[1] - sg.a[1]) * fg, 1.0);
    let gap = Infinity;
    for (let i = 0; i < 4 * 60 * 10; i++) { S.post(0.1, P); P.u = 0; P.v = 0; gap = Math.min(gap, hullGap(S.boat, PADDLE.length - 4, PADDLE.beam, P)); }
    assert.ok(gap > 3, `parked at s ${sAt}: her hull came within ${gap.toFixed(1)} m`);
    assert.ok(S.stats.yields >= 1, `parked at s ${sAt}: she yielded`);
  }
  // crossing her bow at 3 m/s, 150 m ahead
  const S = createPaddleWheeler({ route: ROUTE, hour: 12, seed: 1, depthAt });
  Object.assign(S.boat, { mode: 'run' });
  const h = S.boat.heading, fx = Math.sin(h), fz = -Math.cos(h);
  const P = { x: S.boat.x + fx * 150 - fz * 60, z: S.boat.z + fz * 150 + fx * 60, heading: h - Math.PI / 2, u: 3, v: 0, yawRate: 0 };
  let gap = Infinity;
  for (let i = 0; i < 600; i++) { S.post(0.1, P); P.x += Math.sin(P.heading) * 3 * 0.1; P.z -= Math.cos(P.heading) * 3 * 0.1; gap = Math.min(gap, hullGap(S.boat, PADDLE.length - 4, PADDLE.beam, P)); }
  assert.ok(gap > 3, `crossing: ${gap.toFixed(1)} m`);
});

test('deterministic: the same ?hour and ?seed lay her and run her the same; another seed or hour lays her elsewhere', () => {
  const run = (hour, seed, birth = null) => { const S = createPaddleWheeler({ route: ROUTE, hour, seed, birth, depthAt }); for (let i = 0; i < 600; i++) S.post(0.1); return [S.boat.x, S.boat.z, S.boat.heading, S.boat.v].map((v) => +v.toFixed(6)); };
  assert.deepEqual(run(15, 1), run(15, 1));
  assert.notDeepEqual(run(15, 1), run(15, 2));
  assert.notDeepEqual(run(15, 1), run(11, 1));
  const b = { x: SKI.x, z: SKI.z, headingDeg: 95 };
  assert.deepEqual(run(15, 4, b), run(15, 4, b), 'a birth: the same shift');
  assert.equal(paddleBirthTau(b, { seed: 4, loop: routeLoop(ROUTE) }), paddleBirthTau(b, { seed: 4, loop: routeLoop(ROUTE) }));
});

test('Tessie: a paddle-wheeler target is splashed, never knocked down', () => {
  const S = createPaddleWheeler({ route: ROUTE, hour: 12, seed: 1, depthAt });
  const [e] = S.targets();
  assert.equal(e.kind, 'paddle'); assert.equal(hitRule('paddle'), 'splash');
  assert.equal(S.hit(e.id, 'knock'), false, 'no knockdown for a 46 m hull');
  assert.equal(S.hit(e.id, hitRule('paddle')), true); assert.equal(S.stats.splashes, 1);
});

// ---- the runabouts and the jet ski ----
const ROWS = trafficOf(WATERS);
const traffic = (o = {}) => createPowerTraffic({ rows: ROWS, seed: 1, hour: 15, depthAt, piers: PIERS, ...o });
test('two runabouts out of the Keys and a jet ski: generic, by code; runabouts 15–23 kn, the jet ski cruising 12–18 kn with bursts to 25; the runabouts idle out of the no-wake water and plane up (bow up over the hump, then flatter); the jet ski weaves', () => {
  const T = traffic();
  assert.deepEqual(T.boats.map((b) => b.kind).sort(), ['jetski', 'power', 'power']);
  for (const b of T.boats.filter((o) => o.kind === 'power')) {
    const first = Array.isArray(b.row.route[0]) ? b.row.route[0] : b.row.route[0].at;
    assert.ok(Math.hypot(first[0] - 8100, first[1] - 1400) < 200, `${b.id}: her loop starts at the Keys' channel`);
    assert.ok(b.row.kn[0] >= 15 && b.row.kn[1] <= 25);
  }
  // a runabout from the channel mouth: 5 kn on the slow leg, then the throttle: the bow rises past 5° over the hump, settles under 3.5° planing
  const row = ROWS.find((r) => r.id === 'runabout-a'), T2 = createPowerTraffic({ rows: [row], seed: 1, hour: 15, depthAt });
  const b = T2.boats[0]; Object.assign(b, { s: 0, x: 8020, z: 1440, heading: Math.atan2(-170, 390), v: 5 * KN });
  let humpMax = 0, planeTrim = null, vmax = 0, slowSeen = false;
  for (let i = 0; i < 150 * 20; i++) {
    T2.post(null, 0.05, i * 0.05, { hour: 15 });
    const kn = b.v / KN; vmax = Math.max(vmax, kn);
    if (b.s < 300 && kn < 6) slowSeen = true;
    if (kn > 8 && kn < 14) humpMax = Math.max(humpMax, b.trim / DEG);
    if (kn > 15 && b.plane > 0.9) planeTrim = b.trim / DEG;
  }
  assert.ok(slowSeen, 'idling out of the channel');
  assert.ok(humpMax > 5, `over the hump the bow rises ${humpMax.toFixed(1)}°`);
  assert.ok(planeTrim != null && planeTrim < humpMax - 1.5, `planing she flattens to ${planeTrim?.toFixed(1)}° (the hump ${humpMax.toFixed(1)}°)`);
  assert.ok(vmax >= 15 && vmax <= 23.5, `top ${vmax.toFixed(1)} kn`);
  // the jet ski: a recreational pace (cruising 12–18 kn most of the time, bursts to 23–25 kn), gentle S-curves (her heading swings
  // either way at 3°/s or more, never past 16°/s), the speed eased (under 1 m/s² of change), bow up at speed, rolled into the curves
  const J = createPowerTraffic({ rows: [ROWS.find((r) => r.kind === 'jetski')], seed: 1, hour: 15, depthAt }), j = J.boats[0];
  let left = 0, right = 0, jmax = 0, ymax = 0, amax = 0, cruise = 0, n = 0, last = j.v, trimAt = 0, heelMax = 0, leanMax = 0;
  for (let i = 0; i < 600 * 20; i++) {
    J.post(null, 0.05, i * 0.05, { hour: 15 });
    if (i < 200) { last = j.v; continue; }
    const kn = j.v / KN; n++; if (kn >= 11.5 && kn <= 18.5) cruise++;
    if (j.yawRate > 3 * DEG) right++; if (j.yawRate < -3 * DEG) left++;
    jmax = Math.max(jmax, kn); ymax = Math.max(ymax, Math.abs(j.yawRate)); amax = Math.max(amax, Math.abs(j.v - last) / 0.05); last = j.v;
    if (kn > 12) trimAt = Math.max(trimAt, j.trim / DEG); heelMax = Math.max(heelMax, Math.abs(j.heel)); leanMax = Math.max(leanMax, Math.abs(j.lean));
  }
  assert.ok(left > 300 && right > 300, `S-curves: ${left} ticks to port, ${right} to starboard`);
  assert.ok(cruise / n > 0.7, `cruising 12–18 kn ${(100 * cruise / n).toFixed(0)} % of the time`);
  assert.ok(jmax >= 22 && jmax <= 25.5, `bursts to ${jmax.toFixed(1)} kn`);
  assert.ok(ymax <= 16 * DEG, `yaw at most ${(ymax / DEG).toFixed(1)}°/s`);
  assert.ok(amax <= 1.0, `speed change at most ${amax.toFixed(2)} m/s²`);
  assert.ok(trimAt >= 3, `bow up ${trimAt.toFixed(1)}° at speed`);
  assert.ok(heelMax > 4 * DEG && heelMax <= 14 * DEG + 1e-9 && leanMax > heelMax * 0.5, `rolled ${(heelMax / DEG).toFixed(1)}° into the curves, the rider leaning ${(leanMax / DEG).toFixed(1)}° more`);
});

test('ten minutes at the Ski Run start with the player parked in their way: deep water (3 m) under them, 30 m off every pier, never touching the player, the runabouts and the jet ski passing in view', () => {
  const pose = poseAt(15, 1), birth = { x: pose.x, z: pose.z, headingDeg: pose.headingDeg, look: SKI.look };
  const T = traffic({ birth });
  assert.ok(T.boats.find((b) => b.id === 'jetski').born, 'the jet ski is shifted to pass in view');
  const P = still(pose.x, pose.z, pose.headingDeg * DEG);
  const seen = {}; let dep = Infinity, pier = Infinity, gap = Infinity;
  const t0 = performance.now();
  for (let i = 0; i < 600 * 20; i++) {
    T.post(P, 0.05, i * 0.05, { hour: 15 });
    for (const b of T.live) {
      dep = Math.min(dep, depthAt(b.x, b.z)); pier = Math.min(pier, pierDistance(PIERS, b.x, b.z, 200));
      const d = Math.hypot(b.x - P.x, b.z - P.z); gap = Math.min(gap, hullGap(b, b.C.length, b.C.beam, P));
      if (i < 90 * 20 && d < 500) seen[b.id] = true;
    }
  }
  budget(performance.now() - t0, 1500, '12,000 ticks of three boats');
  assert.ok(dep >= 3, `shallowest ${dep.toFixed(1)} m`);
  assert.ok(pier >= 30, `nearest pier ${pier.toFixed(0)} m`);
  assert.ok(gap > 10, `nearest to the player's hull ${gap.toFixed(1)} m`);
  assert.ok(seen.jetski && seen['runabout-b'], `within 500 m in the first 90 s: ${Object.keys(seen).join()}`);
  // the player parked right on a runabout's line: she gives way (slows and turns), no contact
  const row = ROWS.find((r) => r.id === 'runabout-b'), T3 = createPowerTraffic({ rows: [row], seed: 1, hour: 15, depthAt }), b = T3.boats[0];
  const L = loopOfRow(row); Object.assign(b, { s: 2500, x: 9800, z: -350, heading: Math.atan2(1200, -100), v: 20 * KN });
  const Q = still(10500, -408, 0); let g2 = Infinity;
  for (let i = 0; i < 120 * 20; i++) { T3.post(Q, 0.05, i * 0.05, { hour: 15 }); g2 = Math.min(g2, hullGap(b, b.C.length, b.C.beam, Q)); }
  assert.ok(g2 > 10 && T3.stats.evades >= 1, `parked on her line: ${g2.toFixed(1)} m, ${T3.stats.evades} evasions (loop ${L.length.toFixed(0)} m)`);
});

test('they give way to the paddle-wheeler (her right of way) and to each other; out by day only; a race stands them down', () => {
  const row = ROWS.find((r) => r.id === 'runabout-b'), T = createPowerTraffic({ rows: [row], seed: 1, hour: 15, depthAt }), b = T.boats[0];
  Object.assign(b, { s: 2500, x: 9800, z: -350, heading: Math.atan2(1200, -100), v: 20 * KN });
  const pw = { x: 10600, z: -420, heading: -Math.PI / 2, u: 4, m: POWER.avoid.paddleM };
  let gap = Infinity;
  for (let i = 0; i < 90 * 20; i++) { T.post(null, 0.05, i * 0.05, { hour: 15, others: [pw] }); pw.x -= 4 * 0.05; gap = Math.min(gap, hullGap(b, b.C.length, b.C.beam, pw, PADDLE.length, PADDLE.beam)); }
  assert.ok(gap > 20, `past the paddle-wheeler at ${gap.toFixed(1)} m`);
  const N = traffic(); N.post(null, 0.1, 0, { hour: 21 }); assert.equal(N.live.length, 0, 'night: home');
  const R = traffic(); R.post(null, 0.1, 0, { hour: 13, race: true }); assert.equal(R.live.length, 0, 'a race: none');
});

test('deterministic by ?hour and ?seed; the tiers: 3 boats full, 2 lite (the jet ski and the runabout past Ski Run), 1 on a phone', () => {
  const run = (o) => { const T = traffic(o); for (let i = 0; i < 400; i++) T.post(null, 0.05, i * 0.05, { hour: 15 }); return T.boats.map((b) => [b.id, +b.x.toFixed(5), +b.z.toFixed(5), +b.v.toFixed(5)]); };
  assert.deepEqual(run({}), run({}));
  assert.notDeepEqual(run({}), run({ seed: 2 }));
  assert.notDeepEqual(run({}), run({ hour: 11 }));
  const live = (tier) => { const T = traffic({ tier }); T.post(null, 0.05, 0, { hour: 15 }); return T.live.map((b) => b.id).sort(); };
  assert.equal(live('full').length, 3); assert.deepEqual(live('lite'), ['jetski', 'runabout-b']); assert.deepEqual(live('phone'), ['jetski']); assert.equal(live('off').length, 0);
});

test('Tessie: power and jetski are targets; a runabout is knocked down (heeled hard, righted, on her way); the jet ski\'s rider is splashed only (he ducks, never in the water)', () => {
  assert.equal(HIT_RULE.power, 'knock'); assert.equal(hitRule('jetski'), 'splash'); assert.equal(hitRule('paddle'), 'splash'); assert.equal(hitRule('still'), null);
  const T = traffic(); T.post(null, 0.05, 0, { hour: 15 });
  const list = T.targets(); assert.deepEqual(list.map((e) => e.kind).sort(), ['jetski', 'power', 'power']);
  const H = createTessieHits(), r = list.find((e) => e.kind === 'power');
  const n = { x: r.x - Math.sin(r.heading) * 30, z: r.z + Math.cos(r.heading) * 30, psi: r.heading };
  assert.equal(H.aim(n, list, 0)?.id, r.id, 'in the corners');
  const f = H.fall({ x: r.x, z: r.z, psi: r.heading }, list, 1); assert.equal(f.hit?.id, r.id, 'the fall lands on her');
  // a paddle-wheeler in the list: aimed and hit as a target too
  const P = { id: 'paddle', kind: 'paddle', x: 0, z: -40, heading: Math.PI / 2, u: 4, L: 42, B: 10 };
  assert.equal(createTessieHits().aim({ x: 0, z: 0, psi: 0 }, [P], 0)?.id, 'paddle');
  // the knockdown: heeled past 30°, upright again and under way within 12 s
  const b = T.boats.find((o) => o.id === r.id);
  assert.equal(T.hit(b.id, 'knock', 1), true);
  let peak = 0; for (let i = 0; i < 12 * 20; i++) { T.post(null, 0.05, 0.05 * (i + 1), { hour: 15 }); peak = Math.max(peak, Math.abs(b.heel)); }
  assert.ok(peak > 30 * DEG, `heeled ${(peak / DEG).toFixed(0)}°`); assert.ok(Math.abs(b.heel) < 12 * DEG && b.knockT == null, 'righted');
  // the jet ski: knock refused, splash ducks the rider and slows her; never capsized
  const j = T.boats.find((o) => o.kind === 'jetski');
  assert.equal(T.hit(j.id, 'knock'), false, 'no knockdown for the jet ski');
  const v0 = j.v; assert.equal(T.hit(j.id, 'splash'), true); assert.ok(j.v < v0);
  let duck = 0, heel = 0; for (let i = 0; i < 60; i++) { T.post(null, 0.05, 20 + 0.05 * i, { hour: 15 }); duck = Math.max(duck, j.duck); heel = Math.max(heel, Math.abs(j.heel)); }
  assert.ok(duck > 0.8 && heel < 25 * DEG, `the rider ducks (${duck.toFixed(2)}), the ski stays upright (${(heel / DEG).toFixed(0)}°)`);
  // her clearance ellipses: Tessie's body never passes through them
  const spine = new Float32Array(8 * 4); for (let i = 0; i < 4; i++) { spine[i * 8] = j.x; spine[i * 8 + 1] = -0.2; spine[i * 8 + 2] = j.z + i * 0.3; }
  assert.ok(createTessieHits().holdOff(spine, 1, [{ ...list.find((e) => e.kind === 'jetski'), x: j.x, z: j.z }]) > 0, 'pushed out of the jet ski');
});

// ---- their drawing and sound ----
test('the models: a runabout about 6.6 m with a figure at the helm; a detailed jet ski about 3.2 m under 3.5 k triangles (far under 600): a pointed bow, the sponson ledge, two-tone deck, raised bars, mirrors, the cushion, footwells, grab handle, the pump\'s nozzle, the rider in a buoyancy aid and a helmet', () => {
  const known = new Set(Object.values(SLOT));
  const tris = {};
  for (const kind of ['power', 'jetski']) for (const lod of ['near', 'far']) {
    const a = buildCraft(kind, { lod });
    assert.equal(a.length % (VF * 3), 0);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], rider = 0;
    for (let i = 0; i < a.length; i += VF) { for (let k = 0; k < 3; k++) { assert.ok(Number.isFinite(a[i + k])); lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]); } assert.ok(known.has(a[i + 6]), `slot ${a[i + 6]}`); if (a[i + 6] >= SLOT.rider) rider++; }
    const L = hi[2] - lo[2], want = kind === 'power' ? [6.4, 7.5] : [3.1, 3.7];
    assert.ok(L > want[0] && L < want[1], `${kind} ${lod}: ${L.toFixed(2)} m`);
    assert.ok(rider > 0, `${kind} ${lod}: a figure aboard`);
    tris[`${kind}-${lod}`] = a.length / VF / 3;
  }
  assert.ok(tris['power-near'] <= 8000 && tris['power-far'] <= 300, JSON.stringify(tris));   // near: the cockpit well, the moulded seats and console, the wheel, the outboard's cowling
  assert.ok(tris['jetski-near'] >= 1500 && tris['jetski-near'] <= 3500 && tris['jetski-far'] <= 600 && tris['jetski-far'] * 4 < tris['jetski-near'], JSON.stringify(tris));
  // the jet ski's parts by their slots and places
  const a = buildCraft('jetski', { lod: 'near' }), slots = new Set(); const at = (pred) => { for (let i = 0; i < a.length; i += VF) if (pred(a[i], a[i + 1], a[i + 2], a[i + 6])) return true; return false; };
  for (let i = 0; i < a.length; i += VF) slots.add(a[i + 6]);
  for (const k of ['hood', 'deck', 'mat', 'seatDark', 'seat', 'metal', 'glass', 'vest', 'helmet', 'glove', 'skin', 'trunks']) assert.ok(slots.has(SLOT[k]), `jet ski: ${k}`);
  let bowW = 0; for (let i = 0; i < a.length; i += VF) if (a[i + 6] === SLOT.hull && a[i + 2] < -JET.L / 2 + 0.05) bowW = Math.max(bowW, Math.abs(a[i]));
  assert.ok(bowW < 0.08, `a pointed bow (${bowW.toFixed(3)} m wide at the stem)`);
  assert.ok(at((x, y, z, s) => s === SLOT.metal && z > JET.L / 2 && Math.abs(x) < 0.1 && y < 0.2), 'the nozzle at the stern');
  assert.ok(at((x, y, z, s) => s === SLOT.mat && Math.abs(x) > 0.25 && Math.abs(y - JET.footY) < 1e-6), 'the footwells beside the seat');
  assert.ok(at((x, y, z, s) => s === SLOT.glass && Math.abs(x) > 0.3 && y > 0.6), 'a mirror pair');
  assert.ok(at((x, y, z, s) => s === SLOT.glove && y > JET.barY - 0.1 && Math.abs(z - JET.barZ) < 0.1), 'hands on the bars');
  assert.ok(at((x, y, z, s) => s === SLOT.helmet && y > 1.2), 'a helmet');
  assert.deepEqual(Object.keys(buildCraftMeshes().runs), ['power-near', 'power-far', 'jetski-near', 'jetski-far']);
  assert.equal(lodFor('power', 100), 'near'); assert.equal(lodFor('power', 310, 'near'), 'near'); assert.equal(lodFor('power', 310), 'far');
  assert.ok(DRAW_M.lite.power < DRAW_M.full.power);
  assert.ok(!Object.keys(SLOT).some((k) => /name|text|glyph|letter|logo|livery|brand/i.test(k)));
});

test('the rooster tail: droplets thrown aft and up off the jet ski\'s pump, more and higher with her speed, none slow or knocked; deterministic', () => {
  const run = (kn, seed = 3) => { const b = { x: 0, z: 0, heading: 0, v: kn * KN, knockT: null }; let r = seed; const rnd = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296); const out = []; for (let i = 0; i < 20; i++) roosterTail(b, 0.05, rnd, (x, y, z, vx, vy, vz) => out.push({ x, y, z, vx, vy, vz })); return out; };
  assert.equal(run(4).length, 0, 'none at 4 kn');
  const mid = run(14), fast = run(25);
  assert.ok(fast.length > mid.length && mid.length > 10, `${mid.length} at 14 kn, ${fast.length} at 25 kn in 1 s`);
  const mean = (a, k) => a.reduce((m, d) => m + d[k], 0) / a.length;
  assert.ok(mean(fast, 'vy') > mean(mid, 'vy'), 'higher at speed');
  assert.ok(fast.every((d) => d.z > 1.4 && d.vz + 25 * KN > 5 && d.vy > 0), 'from the stern (heading north: aft is +z), thrown aft of her (relative to her way) and up');
  assert.deepEqual(run(20), run(20));
});

test('their engines: one voice on the nearest boat, faint at 300 m, silent past 600 m', () => {
  const v = nearestVoice([{ x: 100, z: 0, v: 10, kind: 'power' }, { x: 40, z: 0, v: 12, kind: 'jetski' }], [0, 0, 0]);
  assert.equal(v.boat.kind, 'jetski'); assert.ok(v.gain > 0.3);
  assert.ok(powerGain(300) > 0 && powerGain(300) < 0.1); assert.equal(powerGain(650), 0);
});

// ---- the region's loading and the policies ----
const fakeProfile = (win, gpu) => ({ get: () => profileOf(readFacts(win), forcedOf(win.location?.search ?? ''), { gpu }), on: () => () => {} });
const tierOf = (dev, gpu, flags = {}, headless = false) => createFeatures({ profile: fakeProfile({ ...DEVICES[dev], location: { search: '' } }, gpu), doc: null }).configure({ headless, flags }).feature('powerBoats').tier;
test('loaded on selection: the runabouts and the jet ski only for a South Lake start (none for a bay start); the paddle-wheeler on every start; the power tiers by device', () => {
  const row = LAKE_PLUGINS.find((p) => p.id === 'power'), pad = LAKE_PLUGINS.find((p) => p.id === 'paddle');
  const ctx = (levelKey, tiers = {}) => ({ boatOn: true, levelKey, feature: (n) => ({ tier: tiers[n] ?? 'full' }) });
  assert.equal(row.on(ctx('south-lake')), true);
  assert.equal(row.on(ctx('bay')), false, 'a bay start: none');
  assert.equal(row.on(ctx('south-lake', { powerBoats: 'off' })), false);
  assert.equal(pad.on(ctx('bay')), true, 'the paddle-wheeler on a bay start too (her route in view from the bay\'s mouth)');
  for (const [dev, g, want] of [['desktop', 0, 'full'], ['desktop', 2, 'lite'], ['ipadPro', 3, 'lite'], ['iphoneTurned', 1, 'phone'], ['androidSideways', 2, 'phone']]) assert.equal(tierOf(dev, g), want, `${dev} L${g}`);
  assert.equal(tierOf('iphoneTurned', 1, {}, true), 'full', 'a capture: full');
  assert.equal(tierOf('desktop', 0, { power: '0' }), 'off'); assert.equal(tierOf('desktop', 0, { power: 'phone' }), 'phone');
  assert.ok(POLICIES.powerBoats.why.length > 20);
});

test('cost: the three boats\' tick and the paddle-wheeler\'s under 60 µs a tick on this machine (logged; strict under LAKESHORE_STRICT)', () => {
  const T = traffic(), S = createPaddleWheeler({ route: ROUTE, hour: 15, seed: 1, depthAt });
  const P = still(SKI.x, SKI.z);
  for (let i = 0; i < 600; i++) { T.post(P, 1 / 60, i / 60, { hour: 15 }); S.post(1 / 60, P); }
  const t0 = performance.now(), N = 3000;
  for (let i = 0; i < N; i++) { T.post(P, 1 / 60, 10 + i / 60, { hour: 15 }); S.post(1 / 60, P); }
  const us = (performance.now() - t0) * 1000 / N;
  budget(us / 1000, 0.06, `${us.toFixed(1)} µs a tick`);
  assert.ok(us < 2000, `${us.toFixed(1)} µs`);
});
