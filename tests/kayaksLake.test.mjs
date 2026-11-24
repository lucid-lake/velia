// The kayaks on the lake, step 1 (feat/kayaks-lake): who is out by seed, hour, wind and storm; the routes in
// good water off the shore; the levels of detail with hysteresis; a kayak following its route at about cruise speed, on
// the hull model and on the approved paddler. Behaviour only: the modules are called and their output read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTerrain } from '../src/sim/terrain.js';
import { kayakRoutes, pathInWater, okWater, ROUTE_RULES } from '../src/sim/kayaks/routes.js';
import { planFleet, fleetAt, kayakCount, KAYAK_DAY } from '../src/sim/kayaks/plan.js';
import { createAgent, steer, stepHull, applyDrive, coast } from '../src/sim/kayaks/agent.js';
import { pickTier, capFull, pickSteps, LOD, lodFor } from '../src/sim/kayaks/lod.js';
import { kayaksOn } from '../src/sim/kayaks/on.js';
import { parseFlags } from '../src/sim/core/flags.js';
import { tierFor } from '../classic/src/quality/apply.js';
import { createKayak } from '../classic/src/props/kayak/index.js';
import { createPaddler, parsePaddlerGltf, prepareFigure, prepareFigureSteps } from '../classic/src/props/paddler/index.js';

const T = makeTerrain();
const lib = kayakRoutes(T);
const sig = (slots) => slots.map((s) => [s.id, s.route.id, s.s0.toFixed(3), s.colour, s.sex, s.pfd, s.personality, s.restLeft.toFixed(2)].join('|'));

test('the same seed and hour give the same fleet; another seed gives another', () => {
  for (const seed of [1, 2, 7]) {
    assert.deepEqual(sig(planFleet({ seed, terrain: T })), sig(planFleet({ seed, terrain: T })));
    for (const hour of [7, 9.5, 15, 19.5]) assert.deepEqual(sig(fleetAt({ seed, terrain: T, hour })), sig(fleetAt({ seed, terrain: T, hour })));
  }
  assert.notDeepEqual(sig(planFleet({ seed: 1, terrain: T })), sig(planFleet({ seed: 2, terrain: T })));
  // a higher count adds kayaks and keeps the ones already out (the fleet changes one kayak at a time through the day)
  const morning = fleetAt({ seed: 4, terrain: T, hour: 9 }), afternoon = fleetAt({ seed: 4, terrain: T, hour: 16, windMs: 5 });
  assert.ok(afternoon.length <= morning.length);
  assert.deepEqual(sig(afternoon), sig(morning).slice(0, afternoon.length));
  // the colours are the rental ones; men and women both paddle across the seeds
  const all = Array.from({ length: 20 }, (_, i) => planFleet({ seed: i + 1, terrain: T })).flat();
  assert.ok(all.every((s) => ['yellow', 'red', 'orange'].includes(s.colour)));
  assert.ok(all.some((s) => s.sex === 'male') && all.some((s) => s.sex === 'female'));
  assert.deepEqual([...new Set(all.map((s) => s.personality))].sort(), ['casual', 'distracted', 'experienced']);
  assert.ok(all.some((s) => s.restLeft > 0) && all.some((s) => s.restLeft === 0), 'some rest or drift, some paddle');
});

test('every route stays in water 2–60 m deep and ≥ 15 m off the shore (the island counts), inside the bay', () => {
  const kinds = new Set(lib.routes.map((r) => r.kind));
  for (const k of ['shore', 'beach', 'island', 'cove']) assert.ok(kinds.has(k), `no ${k} route`);
  assert.ok(lib.routes.length >= 8, `${lib.routes.length} routes`);
  for (const r of lib.routes) {
    const bad = pathInWater(T, r.path, { step: 2 });
    assert.equal(bad, null, `${r.id} leaves good water at ${JSON.stringify(bad)}`);
    for (let s = 0; s < r.path.length; s += 10) { const p = r.path.at(s); assert.ok(lib.inside(p.x, p.z), `${r.id} leaves the bay at s ${s}`); }
  }
  // the island loop goes round Fannette: its bearing from the island's centre turns a full circle
  const isl = lib.routes.find((r) => r.kind === 'island'), I = T.lake.island;
  let turn = 0, prev = null;
  for (let s = 0; s <= isl.path.length; s += 5) { const p = isl.path.at(s), b = Math.atan2(p.x - I.x, p.z - I.z); if (prev != null) turn += Math.atan2(Math.sin(b - prev), Math.cos(b - prev)); prev = b; }
  assert.ok(Math.abs(Math.abs(turn) - 2 * Math.PI) < 0.2, `the island loop turns ${(turn * 180 / Math.PI).toFixed(0)}°`);
  // the beach route starts off the bay-head beach and reaches the island's loop
  const beach = lib.routes.find((r) => r.kind === 'beach'), b0 = beach.path.at(0);
  assert.ok(Math.hypot(b0.x - T.lake.beach.x, b0.z - T.lake.beach.z) < 60, 'the beach route starts off the beach');
  let near = Infinity; for (let s = 0; s < beach.path.length; s += 5) { const p = beach.path.at(s); near = Math.min(near, Math.hypot(p.x - I.x, p.z - I.z)); }
  assert.ok(near < 120, `the beach route comes within ${near.toFixed(0)} m of the island`);
  // the shore tours keep near the shore: the open middle is the sailors'
  for (const r of lib.routes.filter((q) => q.kind === 'shore')) for (let s = 0; s < r.path.length; s += 10) { const p = r.path.at(s); assert.ok(-T.shoreDistance(p.x, p.z) < 90, `${r.id} strays ${(-T.shoreDistance(p.x, p.z)).toFixed(0)} m off the shore`); }
  assert.equal(ROUTE_RULES.margin, 15);
});

test('the count follows the hour, the wind and a storm', () => {
  const peaks = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const c = (hour, windMs = 0, storm = false) => kayakCount({ hour, windMs, storm, seed });
    for (const h of [0, 3, 5, 6, 20.6, 21, 23]) assert.equal(c(h), 0, `at night (${h} h)`);
    const peak = c(9); peaks.add(peak);
    assert.ok(peak >= 3 && peak <= 6, `the morning's ${peak}`);
    for (const h of [7.5, 8, 10, 11]) assert.equal(c(h), peak, `the morning is the busiest (${h} h)`);
    for (const h of [6.5, 7, 12, 13, 15, 17, 19, 20]) assert.ok(c(h) <= peak && c(h) >= 1, `${h} h: ${c(h)}`);
    assert.ok(c(16) <= Math.ceil(peak / 2), 'fewer in the afternoon');
    assert.equal(c(9, 0, true), 0, 'none in a storm');
    assert.equal(c(9, KAYAK_DAY.maxMs), 0, 'none in a strong wind');
    let last = Infinity; for (let w = 0; w <= 10; w += 0.5) { const n = c(15, w); assert.ok(n <= last, 'more wind never brings more kayaks'); last = n; }
    assert.ok(c(16, 6) <= 2, 'the afternoon breeze leaves 1–2');
  }
  assert.ok(peaks.has(3) && peaks.has(6), `the morning peak spans 3–6 across seeds: ${[...peaks]}`);
});

test('the level of detail switches with hysteresis and caps the full models', () => {
  // in: full under 150 m; it stays full until past 162 m; out to far past 600 m, back to mid under 552 m
  const walk = (ds) => { let t = null; return ds.map((d) => (t = pickTier(t, d))); };
  assert.deepEqual(walk([100, 149, 155, 160, 163, 158, 151, 149]), ['full', 'full', 'full', 'full', 'mid', 'mid', 'mid', 'full']);
  assert.deepEqual(walk([500, 599, 601, 580, 553, 551, 601]), ['mid', 'mid', 'far', 'far', 'far', 'mid', 'far']);
  assert.deepEqual(walk([1000, 120]), ['far', 'full']);
  // a boundary crossed back and forth by a metre never flickers
  let t = 'full', flips = 0; for (let i = 0; i < 100; i++) { const n = pickTier(t, 150 + (i % 2 ? 1 : -1) * 1); if (n !== t) flips++; t = n; }
  assert.ok(flips <= 1, `${flips} flips at the boundary`);
  // only the nearest LOD.maxFull get the full model
  const items = [40, 10, 120, 90, 60].map((d, i) => ({ id: `k${i}`, d, tier: 'full' }));
  capFull(items);
  assert.deepEqual(items.filter((q) => q.tier === 'full').map((q) => q.d).sort((a, b) => a - b), [10, 40, 60].slice(0, LOD.maxFull));
  // the paddler steps: at most LOD.perFrame a frame, the most overdue first; nobody waits longer than 1 / minHz s
  const dt = 1 / 60, ks = [{ d: 30, acc: 0 }, { d: 90, acc: 0 }, { d: 140, acc: 0 }], counts = [0, 0, 0];
  let worstWait = 0;
  for (let f = 0; f < 600; f++) {
    ks.forEach((k) => { k.acc += dt; });
    const now = pickSteps(ks, dt);
    assert.ok(now.length <= LOD.perFrame || now.every((k) => k.acc >= 1 / LOD.minHz));
    for (const k of now) { counts[ks.indexOf(k)]++; worstWait = Math.max(worstWait, k.acc); k.acc = 0; }
  }
  assert.ok(counts[0] > counts[1] && counts[1] >= counts[2], `steps by distance: ${counts}`);
  assert.ok(counts.reduce((s, c) => s + c, 0) <= 600 * LOD.perFrame + 5, `${counts} steps in 600 frames`);
  assert.ok(worstWait <= 1 / LOD.minHz + dt + 1e-9, `a paddler waited ${worstWait.toFixed(3)} s`);
});

test('the kayaks are on by default; ?kayaks=0 turns them off (feat/kayaks-default-on)', () => {
  assert.equal(kayaksOn(parseFlags('').kayaks), true, 'no flag: on');
  assert.equal(kayaksOn(parseFlags('?kayaks=1').kayaks), true);
  assert.equal(kayaksOn(parseFlags('?kayaks=bench').kayaks), true);
  assert.equal(kayaksOn(parseFlags('?kayaks=0').kayaks), false);
  assert.equal(kayaksOn(parseFlags('?kayaks=off').kayaks), false);
});

test('the quality rule: Low and phones run one full paddler and three kayaks; High keeps three and six', () => {
  const hi = lodFor(tierFor('high')), bal = lodFor(tierFor('balanced')), lo = lodFor(tierFor('low')), phone = lodFor(tierFor('high', { phone: true }));
  assert.deepEqual([hi.maxFull, hi.maxOut, hi.full], [LOD.maxFull, KAYAK_DAY.max, LOD.full], 'High is the step-3 LOD');
  assert.deepEqual([bal.maxFull, bal.maxOut], [2, KAYAK_DAY.max]);
  for (const q of [lo, phone]) {
    assert.equal(q.tier, 'low'); assert.equal(q.maxFull, 1); assert.ok(q.maxOut <= 3 && q.maxOut >= 2, 'the two meetings stay');
    // only the nearest gets the full model; the rest wait at mid, and nobody is full past its radius
    const items = [40, 10, 70, 85].map((d, i) => ({ id: `k${i}`, d, tier: pickTier(null, d, q) }));
    capFull(items, q);
    assert.deepEqual(items.filter((x) => x.tier === 'full').map((x) => x.d), [10]);
    assert.equal(pickTier(null, q.full + 5, q), 'mid');
    // the one paddler stepped at most every 2nd frame (30 Hz at 60 fps) inside 50 m, still ≥ minHz
    const k = { d: 20, acc: 0 }; let steps = 0;
    for (let f = 0; f < 600; f++) { k.acc += 1 / 60; if (pickSteps([k], 1 / 60, q).length) { steps++; k.acc = 0; } }
    assert.ok(steps <= 301 && steps >= 290, `${steps} steps in 600 frames`);
  }
  assert.equal(lodFor(null).tier, 'high', 'no tier (node, a tool): High');
});

test('a kayak follows its route at about cruise speed on the hull model, in good water', () => {
  for (const r of lib.routes.filter((q) => q.kind === 'shore').slice(0, 3)) {
    const a = createAgent({ slot: { id: r.id, route: r, s0: 0, restLeft: 0, seed: 3 } });
    let dist = 0, t = 0, worst = 0, along = 0;
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 240; i++) {
      const x0 = a.x, z0 = a.z, sp = a.s;
      stepHull(a, dt, steer(a, dt));
      if (i > 300) { dist += Math.hypot(a.x - x0, a.z - z0); t += dt; along += ((a.s - sp) % r.path.length + r.path.length) % r.path.length; worst = Math.max(worst, a.offRoute); }
      assert.ok(okWater(T, a.x, a.z, 10), `${r.id} left good water at ${a.x.toFixed(0)}, ${a.z.toFixed(0)}`);
    }
    const v = dist / t;
    assert.ok(v > 1.1 && v < 1.45, `${r.id}: ${v.toFixed(2)} m/s (cruise 1.31)`);
    assert.ok(along / t > 1.0, `${r.id}: ${(along / t).toFixed(2)} m/s along the route`);
    assert.ok(worst < 8, `${r.id}: ${worst.toFixed(1)} m off its route`);
  }
});

test('the approved paddler drives a kayak along its route at cruise speed, and takes it over at the same speed', async () => {
  const ld = (f) => { const b = readFileSync(new URL(`../models/paddler/${f}`, import.meta.url)); return parsePaddlerGltf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { textures: false }); };
  const gltf = { male: await ld('ubc-male.glb'), female: await ld('ubc-female.glb') };
  const r = lib.routes.find((q) => q.kind === 'shore');
  const a = createAgent({ slot: { id: 'k', route: r, s0: 40, restLeft: 0, seed: 5 } });
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 20; i++) stepHull(a, dt, steer(a, dt));   // the hull model first, under way
  const vBefore = a.v;
  const k = createKayak({ paddle: 'held', shared: true, colour: 'orange' });
  const p = createPaddler({ gltf, kayak: k, seed: 5, look: { sex: 'female', pfd: 'red' }, mode: 'rest' });
  p.setIntent(a.intent); p.snap(a.phase); p.setBoat({ v: a.v, r: a.r });
  let firstSec = 0, dist = 0, t = 0, worst = 0, last = { ...a.intent };
  for (let i = 0; i < 60 * 30; i++) {
    const it = steer(a, dt);
    if (it.throttle !== last.throttle || it.turn !== last.turn) { p.setIntent(it); last = it; }
    const x0 = a.x, z0 = a.z, out = p.update(dt);
    applyDrive(a, out.boat, out.state.phase);
    if (i < 60) firstSec += a.v / 60;
    if (i > 120) { dist += Math.hypot(a.x - x0, a.z - z0); t += dt; worst = Math.max(worst, a.offRoute); }
    assert.ok(okWater(T, a.x, a.z, 10));
  }
  assert.ok(Math.abs(firstSec - vBefore) / vBefore < 0.2, `the hand-over: ${vBefore.toFixed(2)} → ${firstSec.toFixed(2)} m/s in the first second`);
  const v = dist / t;
  assert.ok(v > 1.05 && v < 1.5, `${v.toFixed(2)} m/s on the paddler (cruise 1.31)`);
  assert.ok(worst < 8, `${worst.toFixed(1)} m off the route`);
  // stepped every third frame (a paddler 100–150 m off), coasting between: the same speed and path
  dist = 0; t = 0; worst = 0; let acc = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const it = steer(a, dt);
    if (it.throttle !== last.throttle || it.turn !== last.turn) { p.setIntent(it); last = it; }
    const x0 = a.x, z0 = a.z; acc += dt;
    if (i % 3 === 2) { const out = p.update(acc); acc = 0; applyDrive(a, out.boat, out.state.phase); } else coast(a, dt);
    dist += Math.hypot(a.x - x0, a.z - z0); t += dt; worst = Math.max(worst, a.offRoute);
  }
  assert.ok(dist / t > 1.05 && dist / t < 1.5, `${(dist / t).toFixed(2)} m/s at a third of the steps`);
  assert.ok(worst < 8, `${worst.toFixed(1)} m off the route at a third of the steps`);
});

test('a figure\'s look-free shapes are built once and shared: the same vest, a disposed paddler leaves it', async () => {
  const ld = (f) => { const b = readFileSync(new URL(`../models/paddler/${f}`, import.meta.url)); return parsePaddlerGltf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { textures: false }); };
  const fresh = await ld('ubc-male.glb'), ahead = await ld('ubc-male.glb');
  assert.equal(prepareFigure(ahead, 'male'), true, 'built ahead (the fleet does it once the figures load)');
  const mk = (g, seed) => createPaddler({ gltf: { male: g, female: g }, kayak: createKayak({ paddle: 'held', shared: true }), seed, look: { sex: 'male', pfd: 'red' }, mode: 'rest' });
  const a = mk(fresh, 3), b = mk(fresh, 4), c = mk(ahead, 3);
  const parts = (p) => { const o = {}; p.group.traverse((m) => { if (m.isMesh) o[m.name] = m; }); return o; };
  const A = parts(a), B = parts(b), C = parts(c);
  assert.ok(A.paddler_pfd && A.paddler_pfd.geometry === B.paddler_pfd.geometry, 'one vest for both paddlers of the figure');
  assert.ok(A.paddler_pfd.geometry.userData.shared);
  assert.notEqual(A.paddler_hat.geometry, B.paddler_hat.geometry, 'the hat is the look\'s own');
  // built ahead or in the build: the same shapes, vertex for vertex
  const pos = (m) => Array.from(m.geometry.attributes.position.array);
  assert.deepEqual(pos(C.paddler_pfd), pos(A.paddler_pfd));
  let disposed = false; A.paddler_pfd.geometry.addEventListener('dispose', () => { disposed = true; });
  a.dispose();
  assert.equal(disposed, false, 'a paddler\'s dispose leaves the shared vest');
});

test('a figure\'s preparation as steps (perf/enter-freeze: one idle task each on a live page): many small steps, the same shapes as in one go', async () => {
  const ld = (f) => { const b = readFileSync(new URL(`../models/paddler/${f}`, import.meta.url)); return parsePaddlerGltf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { textures: false }); };
  const once = await ld('ubc-female.glb'), stepped = await ld('ubc-female.glb');
  assert.equal(prepareFigure(once, 'female'), true);
  const it = prepareFigureSteps(stepped, 'female'), names = [];
  let r; while (!(r = it.next()).done) names.push(r.value);
  assert.equal(r.value, true);
  assert.ok(names.length >= 12, `${names.length} steps: ${names.join(' ')}`);
  for (const n of ['dress-weld', 'pfd-rings', 'pfd-skin']) assert.ok(names.includes(n), n);
  const mk = (g) => createPaddler({ gltf: { male: g, female: g }, kayak: createKayak({ paddle: 'held', shared: true }), seed: 5, look: { sex: 'female', pfd: 'red' }, mode: 'rest' });
  const parts = (p) => { const o = {}; p.group.traverse((m) => { if (m.isMesh) o[m.name || m.material?.name] = m; }); return o; };
  const A = parts(mk(once)), B = parts(mk(stepped));
  assert.ok(B.paddler_pfd.geometry.userData.shared, 'the stepped figure\'s build used the prepared shapes');
  for (const k of Object.keys(A)) for (const at of Object.keys(A[k].geometry.attributes)) {
    assert.deepEqual(Array.from(B[k].geometry.attributes[at].array), Array.from(A[k].geometry.attributes[at].array), `${k}.${at}`);
  }
});
