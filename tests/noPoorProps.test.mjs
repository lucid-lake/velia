// fix/no-poor-props (owner, 2026-11-05: "if we are not confident, do not add them"): the low-poly floats and craft were
// deleted, and what stays on the water is solid: the rival's hull in Regatta, the harbour's
// breakwaters and the towns' decks. Run: node --test tests/noPoorProps.test.mjs
// The world's own wiring (nothing on the water, Cruise with no paddlewheeler) needs the real page: tests/pages/noPoorProps.page.mjs (retired 2026-11-18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, KN, DT, steadyWind } from '../src/sim/boat.js';
import { createTackle, piersFrom, pierDistance, townsDeckHidden } from '../src/sim/boat/tackle.js';
import { layoutShoreline, SHORE_REGION } from '../src/shoreline-layout.js';
import { hullContact, hullGap, outlineDistance } from '../src/sim/race/contact.js';
import { DEFAULT_DIMS } from '../src/sim/boat/dims.js';
const { HULL } = DEFAULT_DIMS;   // this page's boat (its profile)
import { makeTerrain } from '../src/sim/terrain.js';
import { createShoreline } from '../classic/src/shoreline.js';
import { createHarbour } from '../classic/src/harbour.js';
import { createTraffic } from '../src/sim/traffic.js';
import { createTowns } from '../classic/src/towns.js';
import { lonLatToWorld } from '../src/sim/geo.js';
import { createSession } from '../classic/src/modes/regatta/session.js';
import { courseFor } from '../src/sim/race/course.js';
import { startPoses } from '../src/sim/race/sim.js';

const DEG = Math.PI / 180;
const terrain = makeTerrain({ seed: 1 });
const names = (g) => { const n = []; g.traverse((o) => { if (o !== g) n.push(o.name); }); return n; };

test('the shoreline draws no balls, buoys or moored boats; the piers, boathouses and the light stay', () => {
  const s = createShoreline({ terrain, seed: 1, layout: layoutShoreline(terrain, { seed: 1 }) });
  assert.deepEqual([s.layout.balls, s.layout.field, s.layout.hazards, s.layout.speedLine], [[], [], [], []]);
  const n = names(s.group);
  for (const m of ['mooring-balls', 'buoy-cans', 'buoy-bands', 'moored-hulls', 'moored-masts']) assert.ok(!n.includes(m), `no ${m}`);
  assert.ok(s.stats.piers > 0 && n.includes('pier-decks') && n.includes('light-tower'), 'the piers and the light stay');
});

test('the harbour leaves the slips empty; the breakwaters and slips stay', () => {
  const h = createHarbour({ terrain, seed: 1 });
  assert.deepEqual(h.layout.boats, []);
  assert.ok(h.stats.slips > 0, 'the slips stay');
  assert.ok(!names(h.group).some((m) => /harbour-(sail|motor)-/.test(m)), 'no boat meshes');
  assert.ok(piersFrom({ harbour: h.layout }).length > 0, 'the breakwaters stay solid');
});

test('the traffic is an empty schedule: no paddlewheeler, paddlers or sloops; agents() is empty', () => {
  const tr = createTraffic();
  assert.equal(tr.paddlewheeler, null);
  assert.deepEqual([tr.paddlers, tr.sailboats, tr.agents(0), tr.agents(100)], [[], [], [], []]);
});

test('the towns draw no marina boats or masts; the piers stay', async () => {
  const t = { heightAt: () => 5, seed: 1 };
  const n = (await createTowns({ terrain: t, lonLatToWorld })).group.children.map((c) => c.name);
  assert.ok(!n.includes('marina-boats') && !n.includes('marina-masts'), `none (${n})`);
  assert.ok(n.includes('piers'), 'the piers stay');
});

test('the hull outline: inside is negative, outside positive, the normal points out', () => {
  assert.ok(outlineDistance(0, 0).d < -1.4, 'the centre is inside by about half the beam');
  const side = outlineDistance(0, HULL.beam / 2 + 0.5);
  assert.ok(side.d > 0.4 && side.d < 0.6 && side.ny > 0.95, `abeam: ${JSON.stringify(side)}`);
  const bow = outlineDistance(HULL.loa / 2 + 1, 0);
  assert.ok(bow.d > 0.9 && bow.nx > 0.7, `ahead: ${JSON.stringify(bow)}`);
});

test('two hulls: a T-bone at 3 m/s and a glancing blow never leave one inside the other; momentum is kept', () => {
  const kin = (s) => { const sh = Math.sin(s.heading), ch = Math.cos(s.heading); s.x += (s.u * sh + s.v * ch) * DT; s.z += (-s.u * ch + s.v * sh) * DT; s.heading += s.yawRate * DT; };
  for (const [hb, label] of [[Math.PI / 2, 'T-bone'], [Math.PI / 2 + 1.2, 'glancing']]) {
    const A = { x: 0, z: 9, heading: 0, u: 3, v: 0, yawRate: 0 }, B = { x: 0.6, z: 0, heading: hb, u: 0, v: 0, yawRate: 0 };
    let min = Infinity, touches = 0;
    for (let i = 0; i < 10 / DT; i++) { kin(A); kin(B); if (hullContact(A, B)) touches++; min = Math.min(min, hullGap(A, B)); }
    assert.ok(touches > 0, `${label}: they met`);
    assert.ok(min > -0.01, `${label}: the deepest overlap after a step ${min.toFixed(3)} m`);
    assert.ok(A.u < 2.5, `${label}: the striking boat lost way (${A.u.toFixed(2)} m/s)`);
    assert.ok(Math.hypot(B.u, B.v) > 0.2, `${label}: the struck boat was pushed`);
  }
  // apart: nothing happens
  const A = { x: 0, z: 20, heading: 0, u: 3, v: 0, yawRate: 0 }, B = { x: 0, z: 0, heading: 1, u: 0, v: 0, yawRate: 0 };
  assert.equal(hullContact(A, B), null);
  assert.equal(A.u, 3);
});

test('two real boats (BoatPhysics) under sail: one sails into the other, never through it', () => {
  const wind = steadyWind(12 * KN, 270);   // from the west
  const A = new BoatPhysics({ x: 0, z: 22, heading: 0, speed: 2.5 }), B = new BoatPhysics({ x: 0, z: 0, heading: 90 * DEG, speed: 0 });
  let t = 0, min = Infinity, touches = 0;
  for (let i = 0; i < 40 / DT; i++) {
    A.step(DT, { ...CONTROLS }, { windAt: wind, t }); B.step(DT, { ...CONTROLS, furl: 0 }, { windAt: wind, t });
    if (hullContact(A.state, B.state)) touches++;
    min = Math.min(min, hullGap(A.state, B.state)); t += DT;
  }
  assert.ok(touches > 0, 'they met');
  assert.ok(min > -0.01, `never through: deepest ${min.toFixed(3)} m`);
});

test('the regatta session runs the hull contact every tick after both boats stepped', () => {
  const course = courseFor('tahoe-emerald', 'island-sprint');
  const [a, b] = startPoses(course, 210 * DEG, ['me', 'wren']);
  const mk = (p) => { const phys = new BoatPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed }); return { phys, step: (dt, ctl, t, w) => phys.step(dt, ctl, { t, windAt: w }) }; };
  const me = mk(a), wren = mk(b);
  // the rival's own step puts its hull 0.1 m into the player's beam every tick: only a contact run after that step can part them
  const wrenStep = wren.step, before = [];
  wren.step = (...args) => {
    wrenStep(...args);
    const sm = me.phys.state, h = sm.heading, off = HULL.beam - 0.1;
    Object.assign(wren.phys.state, { x: sm.x + Math.cos(h) * off, z: sm.z + Math.sin(h) * off, heading: h, u: sm.u, v: -0.5, yawRate: 0 });
    before.push(hullGap(sm, wren.phys.state));
  };
  const s = createSession({ course, me, wren, baseWind: steadyWind(14 * KN, 210), seed: 1 });
  let worst = Infinity;
  for (let i = 0; i < 10; i++) { s.step(DT); worst = Math.min(worst, hullGap(me.phys.state, wren.phys.state)); }
  assert.ok(before.length === 10 && before.every((g) => g < -0.05), `the rival stepped into the player each tick (${before.map((g) => g.toFixed(2))})`);
  assert.equal(s.contacts.n, 10, 'a contact on every tick');
  assert.ok(s.contacts.maxPen > 0);
  assert.ok(worst > -0.01, `never left inside after a tick: deepest ${worst.toFixed(3)} m`);
});

test('breakwaters and the towns decks are solid: in the tackle, a boat driven at a breakwater stops at its face', () => {
  const harbour = { docks: [], breakwaters: [
    { kind: 'rock', path: [[0, 0], [0, -60]], crestY: 2.2, crestWidth: 4, baseWidth: 18, baseY: -7 },
    { kind: 'crib', path: [[50, 0], [50, -60]], crestY: 1.6, crestWidth: 5, baseY: -5 }] };
  const P = piersFrom({ harbour });
  assert.equal(P.length, 2);
  assert.ok(Math.abs(P[0].half - (4 + 14 * 2.2 / 9.2) / 2) < 1e-9, 'the rock mound: its width at the waterline');
  assert.equal(P[1].half, 2.5);
  // the towns' decks: [mx, y, mz, length, width, yaw, k]; one inside the shoreline's region that towns.js does not draw
  const towns = { piers: { count: 3, data: Float32Array.from([
    -5000, 1.2, -14000, 40, 3, 0, 0,          // a pier along +x
    -5000, 1.5, -14100, 30, 6, Math.PI / 2, 1,   // a breakwater along −z
    100, 1.2, 100, 20, 2, 0, 0]) } };          // inside the shore region: drawn by the shoreline, skipped here
  const T = piersFrom({ towns, skip: townsDeckHidden(SHORE_REGION) });
  assert.equal(T.length, 2);
  assert.ok(pierDistance(T[0], -5000, -14000).d < 0 && pierDistance(T[0], -4979, -14000).d > 0.5, 'the pier spans 40 m along x');
  assert.equal(T[1].kind, 'breakwater');
  assert.ok(pierDistance(T[1], -5000, -14114).d < 0 && pierDistance(T[1], -5000, -14116).d > 0.5, 'the breakwater spans 30 m along z');
  // drive at the crib's west face at 3 m/s: the hull stops outside it
  const tk = createTackle({ depthAt: () => 8, piers: P });
  const b = new BoatPhysics({ x: 30, z: -30, heading: 90 * DEG, speed: 3 });
  b.engine.start();
  const env = { windAt: steadyWind(0, 0), t: 0, ext: tk.ext, post: tk.post };
  let min = Infinity;
  for (let i = 0; i < 30 / DT; i++) { env.t = i * DT; b.step(DT, { ...CONTROLS, throttle: 1, rudder: 0 }, env); min = Math.min(min, tk.hullGap(b.state)); }
  assert.ok(min >= 0, `the smallest hull–breakwater gap ${min.toFixed(3)} m`);
  assert.ok(b.state.x < 50, 'it never passed the breakwater');
});
