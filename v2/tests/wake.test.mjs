// The boat's wake and spray (v2/sim/wake.js, v2/sim/spray.js, v2/render/wake.js): the track, its packing, the JS twins of
// the two maps against v1's physics (src/sim/boat/wakePhysics.js), the scaling with speed, the spray's flight, and the
// GPU side on a fake device (three pipelines at load, none later; two dispatches a frame; the spray uploaded only when it
// changed; nothing at rest).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeTrack, kelvinAtCPU, foamAtCPU, stripProfile, erf, blurredBand, impulseAmp, stampGo, WAKE, POINT_FLOATS, WAKE_SIZES } from '../sim/wake.js';
import { createSpraySim } from '../sim/spray.js';
import { createWakeFx, WAKE_RESP } from '../render/wake.js';
import { createPipelineRegistry } from '../engine/pipelines.js';
import { wakeHeightCPU, transverseWavelength, KELVIN_DEG, TRAIL_DT, TRAIL_N } from '../../src/sim/boat/wakePhysics.js';
import { createBoatSim, waterFor } from '../sim/boat.js';

const L = 7.26, BEAM = 3.15;
// a straight run north (heading 0: −z) at U m/s for `seconds`, stepped at 1/60 s as the ride does
function run(U, seconds = 30, { heading = 0, turn = 0 } = {}) {
  const T = createWakeTrack({ length: L, beam: BEAM });
  const st = { x: 0, z: 0, heading, u: U };
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    st.heading += turn / 60;
    st.x += Math.sin(st.heading) * U / 60; st.z -= Math.cos(st.heading) * U / 60;
    T.update(null, st, 1 / 60);
  }
  const pts = new Float32Array((T.trailN + 1) * POINT_FLOATS), box = new Float64Array(4);
  const n = T.pack(pts, T.boat.x, T.boat.z, box);
  return { T, pts, n, box };
}

test('the track: an impulse every 0.25 s at the transom, newest first, ages from the sim clock, the ring of 96 (24 s)', () => {
  const { T, pts, n } = run(3, 30);
  assert.equal(n, TRAIL_N + 1, 'the transom now + the full ring');
  assert.equal(pts[2], 0, 'point 0: the transom now');
  assert.ok(Math.abs(pts[1] - L / 2) < 1e-4 && Math.abs(pts[0]) < 1e-4, 'the transom is half the waterline length behind the boat');
  for (let i = 1; i < n; i++) assert.ok(pts[i * POINT_FLOATS + 2] > pts[(i - 1) * POINT_FLOATS + 2], 'older going back');
  const age1 = pts[POINT_FLOATS + 2], ageN = pts[(n - 1) * POINT_FLOATS + 2];
  assert.ok(age1 >= 0 && age1 <= TRAIL_DT + 1e-6, `the newest impulse ≤ 0.25 s old: ${age1}`);
  assert.ok(Math.abs(ageN - age1 - (TRAIL_N - 1) * TRAIL_DT) < 1e-3, 'spaced 0.25 s');
  // each impulse sits where the transom was then: 3 m/s × its age behind the transom now
  for (const i of [1, 10, 50]) assert.ok(Math.abs(pts[i * POINT_FLOATS + 1] - (L / 2 + 3 * pts[i * POINT_FLOATS + 2])) < 0.06, `impulse ${i} on the path`);
  assert.equal(T.count, TRAIL_N);
});

test('the Kelvin twin on a straight track is v1\'s impulse sum (src/sim/boat/wakePhysics.js wakeHeightCPU)', () => {
  // v1's frame: the stern now at the origin, the boat heading −z, impulses at τ = i·dt at z = U·τ, the bow source one
  // length ahead of each; ours: the same impulses packed relative to the boat's centre (the stern at +L/2)
  const U = 3, n = TRAIL_N, pts = new Float32Array((n + 1) * POINT_FLOATS);
  pts.set([0, L / 2, 0, 0, 0, -1, U, 1], 0);
  for (let i = 1; i <= n; i++) pts.set([0, L / 2 + U * i * TRAIL_DT, i * TRAIL_DT, impulseAmp(U), 0, -1, U, 1], i * POINT_FLOATS);
  let worst = 0, scale = 0;
  for (const [ax, az] of [[0, 3], [2, 10], [-4, 14], [6, 20], [0, 25], [-9, 30], [1, -2]]) {
    const ours = kelvinAtCPU(pts, n + 1, ax, az + L / 2, { length: L }), v1 = wakeHeightCPU(ax, az, { U, L, n });
    worst = Math.max(worst, Math.abs(ours - v1)); scale = Math.max(scale, Math.abs(v1));
  }
  assert.ok(scale > 0.03, `a real wake: ${scale.toFixed(3)} m`);
  assert.ok(worst < 1e-5, `ours vs v1: worst ${worst.toExponential(2)} m of ${scale.toFixed(3)}`);
});

test('the Kelvin pattern: the wave energy lies inside the 19.47° wedge; the transverse crests 2πU²/g apart behind the stern', () => {
  const { pts, n } = run(3, 40);
  const tan = Math.tan(KELVIN_DEG * Math.PI / 180);
  let inside = 0, outside = 0;
  for (let d = 15; d <= 40; d += 1) for (let s = -1; s <= 1; s += 2) {
    const hIn = kelvinAtCPU(pts, n, s * 0.6 * tan * d, L / 2 + d, { length: L }), hOut = kelvinAtCPU(pts, n, s * 1.8 * tan * d, L / 2 + d, { length: L });
    inside += hIn * hIn; outside += hOut * hOut;
  }
  assert.ok(inside > 20 * outside, `inside ${inside.toExponential(2)} vs outside ${outside.toExponential(2)}`);
  // zero crossings along the centreline from 1 to 5 lengths back: their spacing is the transverse wavelength
  const lam = transverseWavelength(3), zs = [];
  let prev = null;
  for (let z = L; z < 5 * L; z += 0.05) { const h = kelvinAtCPU(pts, n, 0, L / 2 + z, { length: L }); if (prev != null && Math.sign(h) !== Math.sign(prev)) zs.push(z); prev = h; }
  const gaps = zs.slice(1).map((z, i) => z - zs[i]);
  const mean = 2 * gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(Math.abs(mean - lam) / lam < 0.15, `crest spacing ${mean.toFixed(2)} m vs 2πU²/g ${lam.toFixed(2)} m`);
});

test('scaling with speed: the impulse ∝ U², nothing under 0.6 m/s; the transom\'s stamp full by 3 m/s, none at rest', () => {
  assert.equal(impulseAmp(0.5), 0); assert.equal(impulseAmp(3), WAKE.amp); assert.ok(Math.abs(impulseAmp(6) - 4 * WAKE.amp) < 1e-12);
  assert.equal(stampGo(0.3), 0); assert.equal(stampGo(3), 1); assert.ok(stampGo(1.5) > 0 && stampGo(1.5) < 1);
  const slow = run(1.5, 30), fast = run(4, 30);
  const hMax = (r) => { let m = 0; for (let z = 4; z < 40; z += 0.5) for (let x = -12; x <= 12; x += 1) m = Math.max(m, Math.abs(kelvinAtCPU(r.pts, r.n, x, z, { length: L }))); return m; };
  assert.ok(hMax(fast) > 3 * hMax(slow), 'a faster boat leaves a much bigger wake');
  const rest = run(0, 10);
  assert.equal(hMax(rest), 0, 'no wake at rest');
  assert.deepEqual(foamAtCPU(rest.pts, rest.n, 0, L / 2 + 1), [0, 0], 'no foam at rest');
});

test('the foam twin matches v1\'s own foam map (read back from its GPU at the Sail start, 2.95 m/s): along and across the strip', () => {
  const { pts, n, box } = run(2.95, 30);
  const at = (x, aft) => foamAtCPU(pts, n, x, L / 2 + aft, { length: L, beam: BEAM });
  // v1, 2026-11-13 (renders: the probe in the wake notes): [foam, rough] along the track and across it 5 m aft
  // (v1 read 0.258 / 0.156 / 0.027 at 15 / 20 / 30 m: there its path had wandered off the straight line the probe walked,
  // so only the first 10 m, where the path is straight, are compared)
  const v1Along = { 0.5: [0.999, 0.999], 2: [0.924, 0.962], 4: [0.805, 0.9], 6: [0.725, 0.852], 10: [0.514, 0.718] };
  const v1Across = { 0: [0.753, 0.879], 0.5: [0.594, 0.776], 1: [0.25, 0.559], 1.5: [0.055, 0.182], 2.5: [0.013, 0.047] };
  for (const [a, [f, r]] of Object.entries(v1Along)) { const [F, R] = at(0, +a); assert.ok(Math.abs(F - f) < 0.07 && Math.abs(R - r) < 0.07, `${a} m aft: ours ${F.toFixed(3)} / ${R.toFixed(3)}, v1 ${f} / ${r}`); }
  for (const [c, [f, r]] of Object.entries(v1Across)) { const [F, R] = at(+c, 5); assert.ok(Math.abs(F - f) < 0.1 && Math.abs(R - r) < 0.12, `${c} m across: ours ${F.toFixed(3)} / ${R.toFixed(3)}, v1 ${f} / ${r}`); }
  // no side lanes: past 0.6 of the beam nothing reaches foamVisible's 0.45 gate anywhere along the strip
  let side = 0; for (let aft = 0.5; aft < 30; aft += 0.5) side = Math.max(side, at(0.6 * BEAM, aft)[0]);
  assert.ok(side < 0.2, `no side lanes: ${side.toFixed(3)}`);
  // nothing outside the box the GPU skips to
  assert.deepEqual(foamAtCPU(pts, n, box[2] + 0.5, 20), [0, 0]); assert.ok(box[0] < -2 && box[2] > 2 && box[3] > 60, 'the box holds the strip');
  // the blurred band: erf's limits; the stamp itself; the ring's end fades to nothing
  assert.ok(Math.abs(erf(1) - 0.8427) < 0.001 && Math.abs(erf(-0.5) + 0.5205) < 0.001);
  assert.ok(Math.abs(blurredBand(0, 1, 1e-4) - 1) < 1e-6 && Math.abs(blurredBand(1, 1, 0.5) - 0.5) < 0.01);
  assert.ok(stripProfile(0, 0, 1)[0] > 0.99, 'the stamp itself');
  assert.equal(stripProfile(0, TRAIL_N * TRAIL_DT, 1)[1], 0, 'the ring\'s end fades to nothing (no hard edge)');
});

test('a turning track bends the strip: the foam follows the path, not the heading', () => {
  const { T, pts, n } = run(3, 20, { turn: 0.3 });   // 0.3 rad/s: a full circle in 21 s
  // the transom's path 3 s ago, relative to the boat: the strip is there, not straight astern
  const i = Math.round(3 / TRAIL_DT);
  const px = pts[i * POINT_FLOATS], pz = pts[i * POINT_FLOATS + 1];
  const [onPath] = foamAtCPU(pts, n, px, pz);
  const astern = [-T.boat.fx * (L / 2 + 9), -T.boat.fz * (L / 2 + 9)];
  const [straight] = foamAtCPU(pts, n, astern[0], astern[1]);
  assert.ok(onPath > 0.5 && straight < onPath * 0.6, `on the path ${onPath.toFixed(2)}, straight astern ${straight.toFixed(2)}`);
});

test('deterministic and allocation-free in the frame: the same steps pack the same floats; pack reuses its buffer', () => {
  const a = run(2.8, 25), b = run(2.8, 25);
  assert.deepEqual(Array.from(a.pts), Array.from(b.pts));
  const before = a.pts.buffer;
  a.T.pack(a.pts); assert.equal(a.pts.buffer, before);
  a.T.reset(); assert.equal(a.T.pack(a.pts), 0, 'a reset track packs nothing');
});

test('the spray: nothing at 6 kn on flat water, a slam throws a sheet that falls back, the wind blows it aft; deterministic', () => {
  const st = { x: 0, z: 0, heading: 0, u: 3, slam: 0, surf: 0, trueWind: { speed: 8, angle: 0.8 } }, wave = { heave: 0, pitch: 0 };
  const s = createSpraySim({ length: L, beam: BEAM, seed: 1 });
  for (let i = 0; i < 120; i++) s.update(st, wave, 1 / 60);
  assert.equal(s.alive, 0, 'a 28-footer throws no spray in a breeze');
  for (let i = 0; i < 6; i++) s.update({ ...st, slam: 1 }, wave, 1 / 60);
  const thrown = s.alive;
  assert.ok(thrown > 40, `a slam's sheet: ${thrown} drops`);
  let top = -Infinity; for (let i = 0; i < s.core.count; i++) if (s.core.alpha[i] > 0) top = Math.max(top, s.core.pos[3 * i + 1]);
  assert.ok(top > 0.1 && top < 3, `off the bow, up: ${top.toFixed(2)} m`);
  for (let i = 0; i < 120; i++) s.update(st, wave, 1 / 60);
  assert.equal(s.alive, 0, 'back in the water within 2 s');
  // speed alone: from 15 kn
  const f = createSpraySim({ length: L, beam: BEAM, seed: 1 });
  for (let i = 0; i < 60; i++) f.update({ ...st, u: 8.5 }, wave, 1 / 60);
  assert.ok(f.alive > 10, 'over 15 kn the bow throws spray');
  // the same seed and steps: the same drops
  const g = createSpraySim({ length: L, beam: BEAM, seed: 1 });
  for (let i = 0; i < 60; i++) g.update({ ...st, u: 8.5 }, wave, 1 / 60);
  assert.deepEqual(Array.from(g.core.pos), Array.from(f.core.pos));
});

test('the ride steps the track and the spray as v1\'s does (createBoatSim: settle, step)', () => {
  const T = createWakeTrack({ length: L, beam: BEAM });
  let sp = null;
  const wind = { sample: () => ({ vx: 0, vz: 6 }) };
  const B = createBoatSim({ water: waterFor(() => 0), wind, wake: T, makeSpray: (o) => (sp = createSpraySim(o)) });
  B.settle(10);
  assert.ok(T.live && T.count >= 39 && T.count <= 40, `10 s at 1/60: ${T.count} impulses`);
  assert.ok(Math.abs(T.t - 10) < 1e-6);
  assert.ok(sp && typeof sp.alive === 'number', 'the spray made by the ride');
  B.step(1 / 60); assert.ok(Math.abs(T.t - 10 - 1 / 60) < 1e-9);
  assert.ok(Math.abs(T.boat.x - B.state.x) < 1e-9 && Math.abs(T.boat.z - B.state.z) < 1e-9, 'the track knows the boat');
});

// a fake device: enough of WebGPU for createWakeFx to declare its resources and pipelines without a GPU
function fakeDevice() {
  const calls = { writes: [], textures: [], buffers: [] };
  return {
    calls,
    createTexture: (d) => { calls.textures.push(d); return { ...d, createView: () => ({ view: d.label }) }; },
    createSampler: () => ({}), createBuffer: (d) => { calls.buffers.push(d); return { size: d.size, label: d.label }; },
    createBindGroupLayout: (d) => ({ entries: d.entries }), createBindGroup: (d) => ({ entries: d.entries }), createPipelineLayout: (d) => d,
    createShaderModule: ({ label, code }) => ({ label, code, getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipelineAsync: async (d) => ({ label: d.label }), createRenderPipelineAsync: async (d) => ({ label: d.label }),
    queue: { writeBuffer: (buf, off, data, dOff = 0, size) => { calls.writes.push([buf.label, size ?? data.length]); } },
    pushErrorScope() {}, popErrorScope: async () => null,
  };
}

test('the GPU side: three pipelines at load, none after; two dispatches a frame; the maps snapped to their texels; the spray uploaded only when it moved', async () => {
  const errors = [], dev = fakeDevice(), reg = createPipelineRegistry(dev, { errors });
  const fx = createWakeFx({ device: dev, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', sky: { skyBGL: {}, skyBG: {} }, hdrTarget: { format: 'rgba16float' }, length: L, beam: BEAM });
  assert.equal(await reg.buildAll(), 3); assert.deepEqual(reg.names().sort(), ['spray', 'wake-foam', 'wake-kelvin']);
  reg.seal();
  // the two maps in one storage buffer (8 B a texel: four f16), no texture (the water's fragment stage is at 16)
  assert.equal(dev.calls.textures.length, 0);
  assert.equal(dev.calls.buffers.find((b) => b.label === 'wake-maps').size, (WAKE_SIZES.full.kelvin ** 2 + WAKE_SIZES.full.foam ** 2) * 8);
  const c = { dispatches: 0, calls: 0, triangles: 0 }, disp = [];
  const pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups: (...a) => disp.push(a), draw() {} };
  // before the boat moves: off (the readers see 0), no points
  fx.run(pass, c);
  assert.equal(fx.uniforms[3], 0); assert.equal(fx.stats.points, 0);
  const sim = fx.makeSpray({ length: L, beam: BEAM, seed: 1 });
  const st = { x: 1200.3, z: -1050.7, heading: 4.38, u: 2.9, trueWind: { speed: 6, angle: 1 } };
  for (let i = 0; i < 600; i++) { st.x += Math.sin(st.heading) * st.u / 60; st.z -= Math.cos(st.heading) * st.u / 60; fx.track.update(null, st, 1 / 60); sim.update(st, { heave: 0, pitch: 0 }, 1 / 60); }
  const writes0 = dev.calls.writes.length;
  fx.run(pass, c);
  assert.equal(fx.uniforms[3], 1); assert.ok(fx.stats.points >= 40 && fx.stats.points <= 41, `10 s: the transom + 39–40 impulses (v1's clock): ${fx.stats.points}`);
  assert.deepEqual(disp.at(-2), [WAKE_SIZES.full.kelvin / 8, WAKE_SIZES.full.kelvin / 8]); assert.deepEqual(disp.at(-1), [WAKE_SIZES.full.foam / 8, WAKE_SIZES.full.foam / 8]);
  assert.equal(c.dispatches, 4);
  // the centres: the boat snapped to a texel (relative offsets under half a texel)
  const kCell = WAKE.kelvinExtentM / WAKE_SIZES.full.kelvin, fCell = WAKE.foamExtentM / WAKE_SIZES.full.foam;
  assert.ok(Math.abs(fx.uniforms[0]) <= kCell / 2 + 1e-6 && Math.abs(fx.uniforms[4]) <= fCell / 2 + 1e-6);
  assert.ok(Math.abs((fx.track.boat.x + fx.uniforms[0]) / kCell - Math.round((fx.track.boat.x + fx.uniforms[0]) / kCell)) < 1e-6, 'on the world grid');
  // the uniform and the points written; the spray (none alive at 5.6 kn) not drawn
  const w = dev.calls.writes.slice(writes0).map((x) => x[0]);
  assert.ok(w.includes('wake-uniform') && w.includes('wake-points'));
  fx.drawSpray(pass, c); assert.equal(c.calls, 0, 'no droplets: no draw');
  // a slam: drops in the air, uploaded once per change, drawn
  for (let i = 0; i < 4; i++) sim.update({ ...st, slam: 1 }, { heave: 0, pitch: 0 }, 1 / 60);
  const up0 = fx.stats.sprayUploads;
  fx.run(pass, c); fx.run(pass, c);
  assert.equal(fx.stats.sprayUploads, up0 + 1, 'uploaded once for one change');
  fx.drawSpray(pass, c); assert.equal(c.calls, 1);
  assert.equal(reg.late, 0); assert.deepEqual(errors, []);
});

test('the phone set: smaller maps; ?nowake: the readers see off; the slick\'s ripple share follows v1 (none on the swell)', async () => {
  const dev = fakeDevice(), reg = createPipelineRegistry(dev, {});
  const fx = createWakeFx({ device: dev, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', sky: { skyBGL: {}, skyBG: {} }, hdrTarget: { format: 'rgba16float' }, variant: 'phone', on: false });
  assert.equal(dev.calls.buffers.find((b) => b.label === 'wake-maps').size, (WAKE_SIZES.phone.kelvin ** 2 + WAKE_SIZES.phone.foam ** 2) * 8);
  await reg.buildAll();
  fx.track.update(null, { x: 0, z: 0, heading: 0, u: 3 }, 1 / 60);
  fx.run({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {} }, { dispatches: 0 });
  assert.equal(fx.uniforms[3], 0, 'off');
  assert.equal(WAKE_RESP[0], 0); assert.ok(WAKE_RESP[3] >= WAKE_RESP[2] && WAKE_RESP[2] >= WAKE_RESP[1]);
});
