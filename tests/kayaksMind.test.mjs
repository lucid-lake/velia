// The kayakers' minds and the meetings, step 2 (feat/kayaks-lake, § 7): the closest point of approach;
// a kayak on a collision course gives way astern (never ahead of the bow), each personality at its own distance; kayaks
// keep off each other and stay in good water; a normal sail from the start meets a kayaker within 4 minutes, closest ≥ 6 m, typically 8–20 m;
// the same seed gives the same choices; the paddler's head turns to a look; the rig's tabled hull reads as the exact one.
// Behaviour only: the modules are called and their output read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kayakRoutes, okWater } from '../src/sim/kayaks/routes.js';
import { planFleet } from '../src/sim/kayaks/plan.js';
import { createAgent, stepHull } from '../src/sim/kayaks/agent.js';
import { createMind, think, cpa, PERSONA } from '../src/sim/kayaks/mind.js';
import { createKayak } from '../classic/src/props/kayak/index.js';
import { kayakShape } from '../classic/src/props/kayak/shape.js';
import { createPaddler, parsePaddlerGltf } from '../classic/src/props/paddler/index.js';
import { hullAt, hullAtExact } from '../classic/src/props/paddler/rig.js';
import { T, D, START, sail, runFleet } from './helpers/kayak-fleet.mjs';

const lib = kayakRoutes(T);

test('the closest point of approach: time, distance and which side of the bow', () => {
  // head-on, 100 m apart, closing at 4 m/s, 10 m to the side: 25 s, 10 m
  let c = cpa({ x: 10, z: -100, vx: 0, vz: 1 }, { x: 0, z: 0, vx: 0, vz: -3 });
  assert.ok(Math.abs(c.t - 25) < 1e-9 && Math.abs(c.d - 10) < 1e-9, JSON.stringify(c));
  // a kayak crossing from the starboard side, 60 m ahead and 40 m off, at 1.3 m/s; the boat at 3 m/s north
  c = cpa({ x: 40, z: -60, vx: -1.3, vz: 0 }, { x: 0, z: 0, vx: 0, vz: -3 });
  const t = (40 * 1.3 + 60 * 3) / (1.3 ** 2 + 9);
  assert.ok(Math.abs(c.t - t) < 1e-9, `t ${c.t}`);
  assert.ok(Math.abs(c.d - Math.hypot(40 - 1.3 * t, -60 + 3 * t)) < 1e-9);
  // diverging: now is the closest; ahead is + in front of the boat, − behind it
  c = cpa({ x: 0, z: 50, vx: 0, vz: 1 }, { x: 0, z: 0, vx: 0, vz: -3 });
  assert.equal(c.t, 0); assert.ok(c.ahead < 0);
  assert.ok(cpa({ x: 0, z: -50, vx: 1, vz: 0 }, { x: 0, z: 0, vx: 0, vz: 0.1 }).ahead < 0);
  assert.ok(cpa({ x: 0, z: -50, vx: 1, vz: 0 }, { x: 0, z: 0, vx: 0, vz: -0.1 }).ahead > 0);
});

test('on a collision course each personality gives way astern, never across the bow, at its own distance', () => {
  // a kayak on the nearest crossing, timed to meet the boat at its line (the plan's own meeting), for each personality
  const plan = planFleet({ seed: 3, terrain: T, start: START }), meet = plan.find((s) => s.meet);
  assert.ok(meet, 'the plan times a kayak onto a crossing');
  const boat = sail('hold');
  const gaps = {};
  for (const personality of ['experienced', 'casual', 'distracted']) {
    for (const lead of [-3, 0, 3, 6]) {   // the kayak a few seconds early or late at the line
      const s0 = (meet.s0 + lead * 1.28 + meet.route.path.length) % meet.route.path.length;
      const { ks } = runFleet({ seed: 3, boat, secs: 120, slots: [{ ...meet, personality, s0 }] });
      const k = ks[0];
      assert.ok(k.ahead < 0.5, `${personality} (lead ${lead}): ${k.ahead.toFixed(1)} s under the bow`);
      assert.ok(k.wet, `${personality} left good water`);
      assert.ok(k.looked > 1, `${personality} never looked at the boat`);
      gaps[personality] = Math.min(gaps[personality] ?? Infinity, k.min);
    }
  }
  // the gap each keeps (owner 2026-11-08, rounds 2b–2c: close and clear): cautious ≥ 14 m, steady ≥ 6, distracted ≥ 8 m (no
  // contact: step 3 adds it); cautious the widest
  assert.ok(gaps.experienced >= 14, `cautious ${gaps.experienced.toFixed(1)} m`);
  assert.ok(gaps.casual >= 6, `steady ${gaps.casual.toFixed(1)} m`);
  assert.ok(gaps.distracted >= 8, `distracted ${gaps.distracted.toFixed(1)} m`);
  assert.ok(gaps.experienced >= gaps.distracted, JSON.stringify(gaps));
  assert.ok(PERSONA.experienced.actM > PERSONA.casual.actM && PERSONA.casual.actM > PERSONA.distracted.actM);
});

test('a kayak the boat will pass well clear of holds its course (no twitch), and goes back to its route after a give-way', () => {
  // the same crossing, the boat 300 m to the side on a parallel course: nothing to do
  const plan = planFleet({ seed: 3, terrain: T, start: START }), meet = plan.find((s) => s.meet);
  const far = (t, dt) => { const b = sail('hold')(t, dt); return { ...b, x: b.x + 300 * Math.cos(START.heading), z: b.z + 300 * Math.sin(START.heading) }; };
  const quiet = runFleet({ seed: 3, boat: far, secs: 120, slots: [{ ...meet, personality: 'experienced' }] }).ks[0];
  assert.deepEqual([...quiet.actions].filter((x) => x !== 'route' && x !== 'hold'), [], `acted on a far boat: ${[...quiet.actions]}`);
  // after the give-way, the kayak is back on its route within 60 s of the boat passing
  const r = runFleet({ seed: 3, boat: sail('hold'), secs: 200, slots: [{ ...meet, personality: 'experienced' }] }).ks[0];
  assert.ok([...r.actions].some((x) => x === 'astern' || x === 'wait' || x === 'shore'), `never gave way: ${[...r.actions]}`);
  const a = createAgent({ slot: { ...meet, personality: 'experienced' } }), m = createMind({ ...meet, personality: 'experienced' });
  const boat = sail('hold'), dt = 1 / 30;
  for (let i = 0; i < 200 / dt; i++) stepHull(a, dt, think(a, m, dt, { boat: boat(i * dt, dt), others: [a], terrain: T }));
  assert.equal(m.action, 'route'); assert.ok(a.offRoute < 15, `${a.offRoute.toFixed(1)} m off the route at the end`);
});

test('kayaks keep off each other (≥ 8 m wanted, never under 6 m) and off the shore', () => {
  // two kayaks side by side 3 m apart on one shore tour, then a pair on one crossing 10 m apart meeting the boat
  const r = lib.routes.find((q) => q.kind === 'shore');
  const s1 = { id: 'a', route: r, s0: 100, restLeft: 0, seed: 11, personality: 'casual' }, s2 = { ...s1, id: 'b', seed: 12 };
  const a = createAgent({ slot: s1 }), b = createAgent({ slot: s2, x: s1.route.path.at(100).x + 3 * Math.cos(r.path.at(100).heading), z: r.path.at(100).z + 3 * Math.sin(r.path.at(100).heading) });
  const ma = createMind(s1), mb = createMind(s2), dt = 1 / 30;
  let after = Infinity;
  for (let i = 0; i < 90 / dt; i++) {
    for (const [k, m] of [[a, ma], [b, mb]]) stepHull(k, dt, think(k, m, dt, { boat: null, others: [a, b], terrain: T }));
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (i * dt > 15) after = Math.min(after, d);
    assert.ok(okWater(T, a.x, a.z, 10) && okWater(T, b.x, b.z, 10));
  }
  assert.ok(after >= 6, `the pair came within ${after.toFixed(1)} m after 15 s`);
  const meet = planFleet({ seed: 5, terrain: T, start: START }).find((s) => s.meet);
  const pair = [{ ...meet, id: 'p', personality: 'experienced' }, { ...meet, id: 'q', personality: 'distracted', seed: meet.seed + 1, s0: meet.s0 + 10 }];
  const run = runFleet({ seed: 5, boat: sail('island'), secs: 150, slots: pair });
  assert.ok(run.pair >= 6, `two kayakers giving way came within ${run.pair.toFixed(1)} m`);
  for (const k of run.ks) assert.ok(k.wet, `${k.s.id} left good water`);
});

// the 4-minute meetings (144 sails of 240 s, about 7 s) run in the slow lane: tests/slow/kayaksMind.slow.mjs

test('the same seed gives the same choices; the meeting kayaks are the first two slots, on crossings, under way', () => {
  const sig = () => runFleet({ seed: 7, boat: sail('island'), secs: 90 }).ks.map((k) => [k.s.id, k.a.x.toFixed(4), k.a.z.toFixed(4), [...k.actions].join(), k.min.toFixed(4)].join('|'));
  assert.deepEqual(sig(), sig());
  for (let seed = 1; seed <= 10; seed++) {
    const p = planFleet({ seed, terrain: T, start: START });
    assert.ok(p[0].meet && p[1].meet, `seed ${seed}: the first two meet the boat`);
    assert.ok(p.slice(0, 2).every((s) => s.route.kind === 'crossing' && s.restLeft === 0));
    assert.ok(p[0].meet.t < p[1].meet.t && p[0].meet.t >= 45 && p[1].meet.t <= 200, `${p[0].meet.t} ${p[1].meet.t}`);
    assert.ok(!p.slice(2).some((s) => s.meet));
  }
  // no start known (a bench, another mode): no meetings
  assert.ok(planFleet({ seed: 1, terrain: T }).every((s) => !s.meet));
});

test('the paddler looks where it is told (the head to the boat), hands kept on the grips', async () => {
  const ld = (f) => { const b = readFileSync(new URL(`../models/paddler/${f}`, import.meta.url)); return parsePaddlerGltf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { textures: false }); };
  const gltf = { male: await ld('ubc-male.glb'), female: await ld('ubc-female.glb') };
  const k = createKayak({ paddle: 'held', shared: true, colour: 'red' });
  const p = createPaddler({ gltf, kayak: k, seed: 4, look: { sex: 'male', pfd: 'blue' }, mode: 'cruise' });
  // the head's facing (its local +z in the world, on the water's plane), averaged as a vector over a second
  const facing = () => { const h = p.figure.bones.Head; h.updateWorldMatrix(true, false); const e = h.matrixWorld.elements; return [e[8], e[10]]; };
  const meanYaw = (n, each) => { let x = 0, z = 0; for (let i = 0; i < n; i++) { each(); const [fx, fz] = facing(); x += fx; z += fz; } return Math.atan2(x, z); };
  const dt = 1 / 60;
  let worst = 0;
  for (let i = 0; i < 120; i++) p.update(dt);
  const base = meanYaw(60, () => p.update(dt));
  for (const look of [70, -70]) {
    p.setLook(look);
    for (let i = 0; i < 90; i++) { const o = p.update(dt); worst = Math.max(worst, o.handError); }
    const yaw = meanYaw(60, () => { worst = Math.max(worst, p.update(dt).handError); });
    const turned = Math.atan2(Math.sin(yaw - base), Math.cos(yaw - base)) / D;
    assert.ok(Math.abs(turned) > 45, `a ${look}° look turned the head ${turned.toFixed(0)}°`);
    assert.ok(Math.sign(turned) === -Math.sign(look), `a starboard look turns the head to starboard (${turned.toFixed(0)}° for ${look})`);   // (the facing's yaw about +y: a starboard turn is −)
  }
  p.setLook(null); for (let i = 0; i < 90; i++) worst = Math.max(worst, p.update(dt).handError);
  assert.ok(worst < 0.005, `the hands came ${(worst * 1000).toFixed(1)} mm off the grips while looking`);
});

test('the rig tables the hull once: the same half beam and deck top as the analytic shape (under 0.1 mm)', () => {
  const S = kayakShape();
  let worst = 0;
  for (let z = -2.4; z <= 2.4; z += 0.000731) { const a = hullAt(S, z), b = hullAtExact(S, z); worst = Math.max(worst, Math.abs(a.hb - b.hb), Math.abs(a.top - b.top)); }
  assert.ok(worst < 1e-4, `${(worst * 1000).toFixed(3)} mm`);
});

test('the camera notices a kayak passing close: swings low on its far side, holds, eases back; once, never while dragged', async () => {
  const { createNotice, NOTICE } = await import('../src/sim/kayaks/notice.js');
  const { blendShot } = await import('../src/sim/boat/followCamera.js');
  // the boat north at 3 m/s from the origin, a kayak 40 m ahead and 12 m to starboard, still: it comes abeam, drops aft
  const K = { id: 'k', x: 12, z: -40 };
  const run = (opts = {}) => {
    const n = createNotice(), dt = 1 / 60, out = [];
    for (let i = 0; i < 40 / dt; i++) {
      const t = i * dt, boat = { x: 0, z: -3 * t, heading: 0 };
      const r = n.update(dt, { boat, kayaks: [K], dragging: opts.drag?.(t) ?? false, enabled: opts.enabled ?? true });
      out.push({ t, boat, w: r.shot?.w ?? 0, shot: r.shot, phase: r.phase, target: r.target });
    }
    return { n, out };
  };
  const { n, out } = run();
  const t0 = out.find((q) => q.target).t, t90 = out.find((q) => q.w >= 0.9).t;
  assert.ok(t90 - t0 >= 1.5, `${(t90 - t0).toFixed(2)} s to 90 %`);
  const holdS = out.filter((q) => q.phase === 'hold').length / 60;
  assert.ok(holdS >= 3 && holdS <= 5, `holds ${holdS.toFixed(1)} s`);
  const outS = out.filter((q) => q.phase === 'out').length / 60;
  assert.ok(outS >= 1.5, `eases back over ${outS.toFixed(1)} s`);
  let jump = 0; for (let i = 1; i < out.length; i++) jump = Math.max(jump, Math.abs(out[i].w - out[i - 1].w));
  assert.ok(jump < 0.03, `a ${jump.toFixed(3)} step in the weight in a frame`);
  // the held shot: low over the water, ≈ camOff beyond the kayak, on its far side from the boat; the aim nearly level
  for (const q of out.filter((q) => q.phase === 'hold')) {
    const [cx, cy, cz] = q.shot.pos, dK = Math.hypot(cx - K.x, cz - K.z), dB = Math.hypot(cx - q.boat.x, cz - q.boat.z), kB = Math.hypot(K.x - q.boat.x, K.z - q.boat.z);
    assert.ok(Math.abs(cy - NOTICE.camY) < 1e-9 && Math.abs(dK - NOTICE.camOff) < 2.5, `the camera ${dK.toFixed(1)} m from the kayak, ${cy.toFixed(2)} m up`);
    assert.ok(dB > kB, 'the kayak between the camera and the boat');
    const tg = q.shot.target, el = Math.atan2(tg[1] - cy, Math.hypot(tg[0] - cx, tg[2] - cz));
    assert.ok(Math.abs(el) < 3 * D, `the horizon level (aim ${(el / D).toFixed(1)}°)`);
  }
  assert.equal(out[out.length - 1].phase, 'idle'); assert.ok(n.seen.has('k'));
  assert.equal(out.filter((q, i) => i && q.phase === 'in' && out[i - 1].phase !== 'in').length, 1, 'once per kayak');
  // the blend swings round the boat: never under 6 m from it, never under 0.8 m up
  const follow = { pos: [0, 12, 32], target: [0, 1.5, -20], fov: 40 }, c = [0, 0, 0];
  for (let w = 0; w <= 1.0001; w += 0.05) { const p = blendShot(follow, { pos: [-9, 1.7, 0.5], target: [0, 1.5, 0], w }, c).pos; assert.ok(Math.hypot(p[0], p[2]) >= 6 - 1e-9 && p[1] >= 0.8); }
  // a drag starts the ease back at once and nothing is noticed for 4 s; switched off: nothing at all
  const dragged = run({ drag: (t) => t > out.find((q) => q.phase === 'hold').t && t < out.find((q) => q.phase === 'hold').t + 0.2 }).out;
  const dragAt = dragged.find((q) => q.phase === 'out').t;
  assert.ok(dragAt <= out.find((q) => q.phase === 'hold').t + 0.05, 'a drag lets go at once');
  assert.ok(run({ enabled: false }).out.every((q) => q.w === 0 && q.target == null), 'off in Settings');
});
