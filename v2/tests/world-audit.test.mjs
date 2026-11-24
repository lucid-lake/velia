// The world audit's S2 rows (2026-11-14), each against v1's own code: the landmarks and the shore
// flags baked from v1 (G1, G2), the flags' cloth equal to v1's maths and flying from the local wind (limp under 0.6 m/s, level
// by 5.5 m/s, sampled at 5 Hz), the nav lights' halo at v1's size and floor (A1), the mooring pennant (A2), the birds'
// shelter (L1), the kayakers' storm (L2), the show's solid props with their bump (L3), and the dawn chorus and the loons
// (S1a). Each test fails on the code before the fix (the page checks: v2/tests/pages/worldAudit.page.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flagShape as flagShape1, flagFlight as flagFlight1, flagVertex as flagVertex1, SHORE_FLAGS as SF1 } from '../../classic/src/shoreFlags.js';
import { createShoreFlagsSim, flagShape, flagFlight, flagVertex, SHORE_FLAGS } from '../sim/shoreFlags.js';
import { NAV_GLOW, navLights, GLOW_FLOATS } from '../sim/night.js';
import { GLOW } from '../render/night.js';
import { createBoatSim, waterFor, KN } from '../sim/boat.js';
import { createSeamanship } from '../sim/seamanship.js';
import { steadyWind } from '../../src/sim/boat.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';
import { shelterOf } from '../sim/birds.js';
import { createKayakFleet } from '../sim/kayaks.js';
import { bargeProps, bargesWorld, VIEW, patrolInto, BOX_FLOATS } from '../sim/fireworks.js';
import { createSolids, BARGE_POLYS, patrolAngle } from '../sim/solids.js';
import { createSolids as createSolids1, BARGE_POLYS as BARGE_POLYS1 } from '../../classic/src/fireworks/solids.js';
import { patrolAngle as patrolAngle1, BARGE as BARGE1, PATROL as PATROL1 } from '../../classic/src/fireworks/barges.js';
import { BARGE as BARGE2, PATROL as PATROL2 } from '../sim/solids.js';
import { BedsMix } from '../audio/bedsMix.js';
import { AMB_LOOPS, createRecorded } from '../audio/recorded.js';
import { createBeds } from '../audio/beds.js';
import { mixAt } from '../../src/audio.js';

const J = JSON.parse(readFileSync(new URL('../assets/towns/landmarks.json', import.meta.url), 'utf8'));
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => steadyWind(ms, fromDeg)(x, z, t) });

test('G1: v1\'s ruin, stone house and waterfall, baked from src/landmarks.js on v1\'s terrain (the file is the bake\'s bytes)', async () => {
  const { bakeLandmarks } = await import('../../tools/v2-landmarks-bake.mjs');
  assert.equal(readFileSync(new URL('../assets/towns/landmarks.json', import.meta.url), 'utf8'), await bakeLandmarks(), 'landmarks.json is tools/v2-landmarks-bake.mjs\'s output');
  const { LANDMARKS, heightAt, waterfall } = await import('./helpers/ground.mjs');
  const box = (who) => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (const p of J.parts.filter((q) => q.who === who)) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p.pos[i + k]); b[k + 3] = Math.max(b[k + 3], p.pos[i + k]); } return b; };
  const R = box('ruin'), H = box('house'), W = box('waterfall');
  // the ruin on Fannette's summit (4.9 m square, rotated 0.35 rad: its walls within 4 m of the point), 4.6 m tall
  assert.ok(Math.hypot((R[0] + R[3]) / 2 - LANDMARKS.ruin.x, (R[2] + R[5]) / 2 - LANDMARKS.ruin.z) < 1, 'the ruin at the summit');
  assert.ok(Math.abs(R[4] - R[1] - 4.6) < 0.05 && R[1] < heightAt(LANDMARKS.ruin.x, LANDMARKS.ruin.z), `the gable 4.6 m over a floor sunk into the knob (${(R[4] - R[1]).toFixed(2)} m)`);
  // the house at the bay's head: 30 × 11 m and its stair wing, the sod ridge 10.5 m up, the cap's peak 11.3 m
  assert.ok(Math.hypot((H[0] + H[3]) / 2 - LANDMARKS.house.x, (H[2] + H[5]) / 2 - LANDMARKS.house.z) < 6, 'the house at its spot');
  assert.ok(Math.abs(H[4] - H[1] - 11.3) < 0.1, `the house 11.3 m from its foot to the wing's cap (${(H[4] - H[1]).toFixed(2)})`);
  // the waterfall on the creek's lower fall (terrain.waterfall()), its ribbon's uv along it, the foam at its foot
  const w = waterfall(), fall = J.parts.find((p) => p.kind === 3), foam = J.parts.find((p) => p.kind === 4);
  assert.equal(fall.pos.length / 3, 50, 'v1\'s 24 segments'); assert.ok(fall.uv.length === 100 && foam.pos.length / 3 === 22);
  assert.ok(Math.hypot((fall.pos[0] + fall.pos[3]) / 2 - w.b[0], (fall.pos[2] + fall.pos[5]) / 2 - w.b[1]) < 0.01, 'its foot at the fall\'s foot');
  assert.ok(Math.abs(W[4] - W[1] - J.stats.waterfallDropM) < 3, `the ribbon drops ${(W[4] - W[1]).toFixed(1)} m (v1's fall ${J.stats.waterfallDropM} m)`);
  // v1's materials: the two stones, the sod, the timber, the glass, the waterfall's streaks, the foam
  const kinds = new Set(J.parts.map((p) => `${p.kind}:${p.a.toString(16)}`));
  for (const k of ['1:6f6c66', '1:7a766d', '2:5a6436', '0:3a2a1c', '0:1a1d20', '3:f2f5f4', '4:e6ecec']) assert.ok(kinds.has(k), `material ${k}`);
});

test('G2: the five flags at v1\'s sites (the lawn, two pier heads, the club, the harbour pier) with v1\'s poles', () => {
  const S = J.flags.sites;
  assert.deepEqual(S.map((s) => s.name), ['stone-house-lawn', 'stone-house-pier', 'camp-pier', 'club-lawn', 'harbour-pier']);
  // the audit's v1 probe: poles at (−534, 186), (−510, 104), (369, −595), (5204, 1709), (5342, 1630)
  const probe = [[-534, 186], [-510, 104], [369, -595], [5204, 1709], [5342, 1630]];
  S.forEach((s, i) => assert.ok(Math.hypot(s.x - probe[i][0], s.z - probe[i][1]) < 1.5, `${s.name} at (${s.x}, ${s.z})`));
  assert.equal(J.poles.length, 5);
  for (const [i, p] of J.poles.entries()) { let top = -Infinity; for (let k = 1; k < p.pos.length; k += 3) top = Math.max(top, p.pos[k]); assert.ok(Math.abs(top - S[i].y - S[i].h) < 1e-3, `${S[i].name}'s pole ${S[i].h} m`); }
});

test('G2: the cloth is v1\'s flagShape, flagFlight and flagVertex number for number', () => {
  assert.deepEqual({ ...SHORE_FLAGS }, { sampleHz: SF1.sampleHz, tauS: SF1.tauS, limpMs: SF1.limpMs, fullMs: SF1.fullMs, droopMax: SF1.droopMax, segU: SF1.segU, segV: SF1.segV });
  for (const s of J.flags.sites) for (const sp of [0.2, 0.6, 2, 5.5, 9, 16]) for (const dir of [0, 1.3, 3.9]) {
    const w = { vx: Math.sin(dir) * sp, vz: Math.cos(dir) * sp, speed: sp };
    const a = flagFlight1(w, s.L), b = flagFlight(w, s.L);
    for (const k of Object.keys(a)) assert.ok(Math.abs(a[k] - b[k]) < 1e-12, `${k}`);
    for (const [u, v] of [[0, 0], [0.5, 0.5], [1, 1], [0.25, 0.75]]) {
      assert.deepEqual(flagShape(s, u, v), flagShape1(s, u, v));
      const p1 = flagVertex1(s, a, u, v, 3.7, 0.4), p2 = flagVertex(s, b, u, v, 3.7, 0.4);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(p1[k] - p2[k]) < 1e-9);
    }
  }
});

test('G2: each flag flies from the local wind at 5 Hz: limp under 0.6 m/s, level by 5.5 m/s, downwind, eased', () => {
  const sites = J.flags.sites;
  let speed = 0.3, calls = 0;
  const wind = { sample: (x, z, t) => { calls++; return { vx: speed * Math.sin(1.1), vz: speed * Math.cos(1.1), speed }; } };
  const F = createShoreFlagsSim({ sites, wind, seed: 1 });
  F.update(0);
  for (let i = 0; i < sites.length; i++) assert.ok(F.flight(i).droop > 70 * Math.PI / 180, 'limp: hangs ≈ 82° below level');
  speed = 8; calls = 0;
  for (let k = 1; k <= 600; k++) F.update(k / 60);   // 10 s at 60 fps
  // v1's cadence: each flag's next sample 1 / 5 s + 0.031 s × its index on (5, 4.3, 3.8, 3.4, 3.1 Hz: 196 in 10 s)
  assert.ok(calls >= 185 && calls <= 205, `≈ 5 samples a second a flag, staggered (${calls} in 10 s)`);
  for (let i = 0; i < sites.length; i++) {
    const f = F.flight(i);
    assert.ok(f.droop < 5 * Math.PI / 180, `level in 8 m/s (${(f.droop * 180 / Math.PI).toFixed(1)}°)`);
    assert.ok(Math.abs(f.fx - Math.sin(1.1)) < 1e-3 && Math.abs(f.fz - Math.cos(1.1)) < 1e-3, 'the fly downwind');
    // the cloth: the fly's tip downwind of the hoist, the normals unit length
    const o = (i * F.per + SHORE_FLAGS.segU) * 3, h = (i * F.per) * 3;
    assert.ok((F.positions[o] - F.positions[h]) * Math.sin(1.1) + (F.positions[o + 2] - F.positions[h + 2]) * Math.cos(1.1) > sites[i].L * 0.8);
  }
  for (let q = 0; q < F.normals.length; q += 3) assert.ok(Math.abs(Math.hypot(F.normals[q], F.normals[q + 1], F.normals[q + 2]) - 1) < 1e-6);
});

test('A1: the nav lights\' halo at v1\'s size (0.35 m) with its own 22 px floor; the town windows keep theirs', () => {
  assert.equal(NAV_GLOW.size, 0.35); assert.equal(NAV_GLOW.minPx, 22); assert.equal(GLOW.minPx, 3);
  const out = new Float32Array(3 * GLOW_FLOATS);
  navLights(out, { pose: { x: 0, z: 0, heading: 0, heave: 0, pitch: 0, heel: 0 }, sunElevDeg: -12, eye: [0, 3, -60], dims: DEFAULT_DIMS.HULL });
  for (let i = 0; i < 3; i++) assert.equal(out[i * GLOW_FLOATS + 3], Math.fround(0.35), 'each lens 0.35 m across');
  assert.ok(out[1 * GLOW_FLOATS + 7] > 0 || out[0 * GLOW_FLOATS + 7] > 0, 'a bow light lit toward a viewer ahead');
});

test('A2: moored, the pennant runs from the bow roller to the ball in v1\'s 8 points (sag 0.35 m)', () => {
  const flat = waterFor(() => 0);
  const B = createBoatSim({ water: flat, heightAt: () => -20, wind: steady(0.02 * KN, 0), start: { x: 0, z: 0, headingDeg: 90, speed: 0 } });
  const sea = createSeamanship({ B, depthAt: () => 20, timeScale: 1 });
  B.sea = sea;
  const bow = sea.tackle.bow(B.state), ball = { x: bow[0] + 2.5, z: bow[1] };   // 2.5 m ahead of the bow (east)
  sea.setPiers([], [ball]);
  B.step(1 / 60, { steer: 0, pull: 0 });
  assert.equal(B.pose.pennant ?? null, null, 'no pennant when free');
  const r = sea.tackle.moor(B.state);
  assert.ok(r.ok, `moored (${r.why})`);
  for (let i = 0; i < 30; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  const P = B.pose.pennant;
  assert.equal(P.length, 8);
  assert.ok(Math.hypot(P[7][0] - ball.x, P[7][2] - ball.z) < 1e-9 && Math.abs(P[7][1] - 0.25) < 1e-9, 'its end at the ball, 0.25 m up');
  const mid = P[3], lin = P[0][1] * (1 - 3 / 7) + 0.25 * 3 / 7;
  assert.ok(Math.abs(lin - mid[1] - 0.35 * Math.sin(Math.PI * 3 / 7)) < 1e-9, 'v1\'s sag');
  sea.tackle.release();
  B.step(1 / 60, { steer: 0, pull: 0 });
  assert.equal(B.pose.pennant, null, 'released: gone');
});

test('L1: the storm\'s shelter for the birds is v1\'s min(1, rain × 1.5)', () => {
  assert.equal(shelterOf(0), 0); assert.equal(shelterOf(0.4), 0.6000000000000001); assert.equal(shelterOf(1), 1); assert.equal(shelterOf(null), 0);
});

test('L2: in a storm the kayak fleet wants v1\'s count: the first pair only at 10:00 (the wiring: worldAudit.page.mjs)', async () => {
  const { makeTerrain } = await import('./helpers/ground.mjs');
  const T = makeTerrain();
  const start = { x: 1200, z: -1050, heading: 251 * Math.PI / 180 };
  const mk = (storm) => { const F = createKayakFleet({ terrain: T, seed: 1, start, boat: () => ({ ...start, u: 0, v: 0, sog: 0, yawRate: 0 }), heightAt: () => 0, hour: () => 10, wind: () => 2.12, storm: () => storm }); F.lay({ x: start.x - 30, z: start.z, yaw: 0, hHalf: 0.6 }); return F; };
  const calm = mk(false).stats().want, wet = mk(true).stats().want;
  assert.ok(calm > wet, `calm ${calm}, storm ${wet}`);
  assert.equal(wet, 2, 'the first pair only (v1: 2 at 10:00, stormt=150)');
});

test('L3: the drawn tug and patrol boats sit in v1\'s solid outlines; a bump moves the drawn patrol boat with its body', () => {
  const B = bargesWorld(), props = bargeProps(B);
  const solids = createSolids({ barges: B, toward: VIEW, wet: null, sailboats: [] });
  for (const [bi, b] of B.entries()) {
    const body = solids.bodies.find((x) => x.kind === 'barge' && x.barge === bi);
    // the tug's hull box (the box behind the barge on its axis) in the barge body's frame: inside BARGE_POLYS[1]
    const tug = props.boxes.find((x) => x.h[0] === 6 && Math.abs(x.h[2] - 2.5) < 1e-9 && Math.hypot(x.c[0] - b.x, x.c[2] - b.z) < 40 && Math.hypot(x.c[0] - b.x, x.c[2] - b.z) > 18);
    assert.ok(tug, 'a 12 × 5 m pushboat on the barge\'s axis');
    const fx = Math.sin(body.heading), fz = -Math.cos(body.heading), sx = Math.cos(body.heading), sz = Math.sin(body.heading);
    const dx = tug.c[0] - body.x, dz = tug.c[2] - body.z, bx = dx * fx + dz * fz, by = dx * sx + dz * sz;
    const r = BARGE_POLYS[1], xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    assert.ok(bx > Math.min(...xs) && bx < Math.max(...xs) && Math.abs(by) < 0.01, `the pushboat's centre (${bx.toFixed(1)}, ${by.toFixed(1)}) in its solid outline`);
  }
  // the patrol boats: the drawn ones at the solid bodies' poses (−heading = the drawn yaw)
  for (const body of solids.bodies.filter((x) => x.kind === 'patrol')) {
    const p = props.patrols[body.barge * 2 + body.side];
    assert.ok(Math.hypot(p.x - body.x, p.z - body.z) < 1e-6 && Math.abs(Math.atan2(Math.sin(p.yaw + body.heading), Math.cos(p.yaw + body.heading))) < 1e-9, 'patrol pose');
  }
  const boxData = new Float32Array(props.boxes.length * BOX_FLOATS), lampData = new Float32Array(props.lamps.length * 8);
  const p0 = props.patrols[0];
  patrolInto(boxData, lampData, p0, p0.x + 3, p0.z, p0.yaw);
  assert.ok(Math.abs(boxData[p0.box * BOX_FLOATS] - (props.boxes[p0.box].c[0] + 3)) < 1e-3, 'the shoved patrol boat\'s hull drawn 3 m over');
});

test('L3: v2\'s solids are v1\'s: the patrol numbers, the bodies, and a collision step for step', () => {
  // the barges' plan is the real barge's since 2026-11-18 (36.6 × 9.1 m, BARGE_POLYS); the patrol boats, their zone and the contact stay v1's
  assert.equal(BARGE_POLYS.length, BARGE_POLYS1.length); assert.equal(BARGE2.zone, BARGE1.zone);
  assert.equal(PATROL2.length, PATROL1.length); assert.equal(PATROL2.beam, PATROL1.beam);
  for (const s of [-1, 1]) for (const b of bargesWorld()) assert.equal(patrolAngle(0.3, s, b, (x) => x > b.x + 50), patrolAngle1(0.3, s, b, (x) => x > b.x + 50));
  const opts = () => ({ barges: bargesWorld(), toward: VIEW, wet: null, sailboats: [{ x: VIEW[0] + 40, z: VIEW[1], heading: 1 }] });
  const a = createSolids(opts()), b = createSolids1(opts());
  assert.equal(a.bodies.length, b.bodies.length);
  const P = a.bodies.find((x) => x.kind === 'patrol'), x0 = P.x - 9, z0 = P.z;   // (read before the runs: the bump moves it)
  const run = (S) => { const st = { x: x0, z: z0, heading: Math.PI / 2, u: 2.5, v: 0, r: 0, p: 0, heel: 0, sog: 2.5 }; const out = []; for (let i = 0; i < 240; i++) { st.x += st.u * Math.sin(st.heading) / 60; st.z -= st.u * Math.cos(st.heading) / 60; S.post(st, 1 / 60, i / 60); out.push([st.x, st.z, st.u, st.v, st.r]); } return { out, pen: S.stats.maxPen, contacts: S.stats.contacts, bodies: S.bodies.map((q) => [q.x, q.z, q.heading]) }; };
  const ra = run(a), rb = run(b);
  assert.ok(ra.contacts > 0, `the run bumps the patrol boat (${ra.contacts} contacts)`);
  assert.deepEqual(ra, rb, 'the same contacts, impulses and props\' swing as v1\'s');
});

test('L3: our boat sailing into a barge is stopped by v1\'s solids in the boat\'s own tick, with a bump', () => {
  const B0 = bargesWorld()[0];
  const solids = createSolids({ barges: [B0], toward: VIEW, wet: null, sailboats: [] });
  const body = solids.bodies.find((b) => b.kind === 'barge');
  // start 30 m off the barge's beam, heading straight at it at 3 m/s (6 kn)
  const sx = Math.cos(body.heading), sz = Math.sin(body.heading);
  const start = { x: body.x + sx * 30, z: body.z + sz * 30 };
  const headingDeg = (Math.atan2(-sx, sz) * 180 / Math.PI + 360) % 360;   // toward the barge: forward (sin h, −cos h) = −side
  const Bt = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(0.02 * KN, 0), start: { ...start, headingDeg, speed: 3 } });
  const sea = createSeamanship({ B: Bt, depthAt: () => 40, timeScale: 1 });
  Bt.sea = sea;
  const bumps = [];
  solids.onBump = (e) => bumps.push(e);
  const off = sea.addPost((st, dt, t) => solids.post(st, dt, t));
  let minGap = Infinity;
  for (let i = 0; i < 60 * 20; i++) { Bt.step(1 / 60, { steer: 0, pull: 0 }); minGap = Math.min(minGap, solids.gap(Bt.state)); }
  assert.ok(solids.stats.contacts > 0, 'contact');
  assert.ok(bumps.length >= 1, `a bump (j ${bumps[0]?.j?.toFixed(0)})`);
  assert.ok(minGap > -0.25, `never through it (worst gap ${minGap.toFixed(3)} m)`);
  off();
});

test('S1a: the dawn chorus (05:54–08:30) and the loons (night and twilight) at v1\'s gains, from v1\'s recordings', async () => {
  assert.ok(AMB_LOOPS.includes('birds_dawn') && AMB_LOOPS.includes('loon'));
  const at = (hour, earWind = 1) => new BedsMix({ seed: 1 }).stepWind({ hour, earWind, shoreDist: 400, rain: 0, state: {} });
  const dawn = at(6.9), noon = at(13), night = at(22.5);
  const v1 = (hour) => mixAt({ hour, windSpeed: 1, shoreDist: -400, rain: 0 }).gains;
  assert.ok(dawn.gains.birds > 0.1 && Math.abs(dawn.gains.birds - v1(6.9).birds_dawn) < 1e-12, `the chorus at 06:54 (${dawn.gains.birds.toFixed(3)})`);
  assert.equal(noon.gains.birds, 0); assert.equal(noon.gains.loon, 0);
  assert.ok(night.gains.loon > 0.2 && Math.abs(night.gains.loon - v1(22.5).loon) < 1e-12, `the loons at 22:30 (${night.gains.loon.toFixed(3)})`);
  // the recordings: fetched once each by v1's paths (Opus; the AAC twin where Opus does not decode)
  const seen = [];
  const fakeParam = () => ({ value: 0, setTargetAtTime() {}, cancelAndHoldAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setValueCurveAtTime() {} });
  const node = (x = {}) => ({ connect(n) { return n; }, disconnect() {}, ...x });
  const fb = (ch, n, sr) => { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { duration: n / sr, length: n, sampleRate: sr, numberOfChannels: ch, getChannelData: (c) => d[c] }; };
  const ctx = { sampleRate: 8000, currentTime: 0, destination: node(), state: 'running', createGain: () => node({ gain: fakeParam() }), createBiquadFilter: () => node({ frequency: fakeParam(), Q: fakeParam(), gain: fakeParam() }),
    createBufferSource: () => node({ playbackRate: fakeParam(), start() {}, stop() {} }), createOscillator: () => node({ frequency: fakeParam(), start() {}, stop() {}, setPeriodicWave() {} }), createStereoPanner: () => node({ pan: fakeParam() }),
    createChannelSplitter: () => node(), createChannelMerger: () => node(), createDynamicsCompressor: () => node({ threshold: fakeParam(), knee: fakeParam(), ratio: fakeParam(), attack: fakeParam(), release: fakeParam() }),
    createWaveShaper: () => node(), createPeriodicWave: () => ({}), createBuffer: fb, decodeAudioData: async () => fb(1, 8000 * 8, 8000) };
  const G = globalThis;
  G.GainNode = function () { return ctx.createGain(); }; G.BiquadFilterNode = function () { return ctx.createBiquadFilter(); }; G.AudioBufferSourceNode = function (c, o = {}) { return Object.assign(ctx.createBufferSource(), { buffer: o.buffer }); };
  G.OscillatorNode = function () { return ctx.createOscillator(); }; G.AudioBuffer = function (o) { return fb(o.numberOfChannels ?? 1, o.length, o.sampleRate); };
  const beds = createBeds(ctx);
  const rec = createRecorded(ctx, { effects: beds.inputs.effects, ambience: beds.inputs.ambience, base: 'audio/', fetchFn: async (u) => { seen.push(u); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1000) }; } });
  await rec.ready;
  for (const f of ['audio/birds_dawn.opus', 'audio/loon.opus']) assert.equal(seen.filter((u) => u === f).length, 1, f);
});
