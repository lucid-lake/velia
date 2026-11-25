// The paddle-wheeler (South Lake's birthplace, phase C part 1; v2/sim/paddleWheeler.js, v2/render/paddleWheelerMesh.js,
// v2/render/paddleWheeler.js, v2/living/paddleWheeler.js, src/core/features.js paddleWheeler): the model builds (its size, the
// triangles per LOD, one draw), the wheel turns with her speed, she floats at the waterline, the LODs and the lite tier's reach,
// off in play (placed only by ?paddle=), her wake in the vessels' map (yielding it to the glass boat), unnamed. Behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaddleWheeler, parsePaddle, wheelRate, PADDLE, TRAIL_DT } from '../sim/paddleWheeler.js';
import { buildPaddle, buildPaddleMeshes, lodFor, hullHalfBeam, hullSheer, SLOT, VF, LOD_M, DRAW_M } from '../render/paddleWheelerMesh.js';
import { createPaddleRender } from '../render/paddleWheeler.js';
import { createPaddlePlugin } from '../living/paddleWheeler.js';
import { sources, createVesselWake, VESSEL } from '../render/vesselWake.js';
import { createWakeFx } from '../render/wake.js';
import { createPipelineRegistry } from '../engine/pipelines.js';
import { createFeatures, POLICIES } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';
import { parseV2Flags, V2_ROWS } from '../engine/flags.js';
import { GLOW_FLOATS } from '../sim/night.js';

const KN = 0.514444;
// a fake GPU (the glass boat's test's): the calls recorded, nothing drawn
function fakeGpu() {
  const calls = { writes: [], buffers: [] };
  const device = {
    createBuffer: (d) => { calls.buffers.push(d); return { size: d.size, label: d.label }; }, createTexture: (d) => ({ ...d, createView: () => ({}) }), createSampler: () => ({}),
    createBindGroupLayout: (d) => d, createBindGroup: (d) => d, createPipelineLayout: (d) => d,
    createShaderModule: ({ label, code }) => ({ label, code, getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipelineAsync: async (d) => ({ label: d.label }), createRenderPipelineAsync: async (d) => ({ label: d.label }),
    queue: { writeBuffer: (buf) => calls.writes.push(buf.label) }, pushErrorScope() {}, popErrorScope: async () => null,
  };
  globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }; globalThis.GPUBufferUsage ??= { COPY_DST: 8, UNIFORM: 64, STORAGE: 128, VERTEX: 32 };
  globalThis.GPUBufferUsage.VERTEX ??= 32;
  const errors = [], reg = createPipelineRegistry(device, { errors });
  const base = { device, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', sky: { skyBGL: {}, skyBG: {} }, hdrTarget: { format: 'rgba16float' },
    shadow: { view: {}, sampler: {}, buffer: {} }, depthFormat: 'depth32float', msaa: 4 };
  return { device, reg, errors, calls, base };
}
const passRec = () => { const draws = []; return { draws, setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, draw: (...a) => draws.push(a), dispatchWorkgroups() {} }; };
const bbox = (a) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.length; i += VF) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]); } return { lo, hi }; };

// ---- the model ----
test('the model builds: about 46 m long on the guards and the wheel, 10 m on the guards, the stacks about 13 m up; every LOD lighter than the last; every vertex finite, every slot known', () => {
  const known = new Set(Object.values(SLOT));
  const tris = {};
  for (const lod of ['near', 'mid', 'far']) {
    const a = buildPaddle({ lod });
    assert.equal(a.length % (VF * 3), 0, `${lod}: whole triangles`);
    for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), `${lod}: finite at ${i}`);
    for (let i = 6; i < a.length; i += VF) assert.ok(known.has(a[i]), `${lod}: slot ${a[i]}`);
    const { lo, hi } = bbox(a);
    let hullLo = Infinity; for (let i = 0; i < a.length; i += VF) if (a[i + 6] < SLOT.wheel) hullLo = Math.min(hullLo, a[i + 1]);
    const L = hi[2] - lo[2], B = hi[0] - lo[0];
    assert.ok(L > 45 && L < 47.5, `${lod}: length ${L.toFixed(2)} m`);
    assert.ok(B > 9.8 && B < 10.3, `${lod}: beam ${B.toFixed(2)} m`);
    assert.ok(hi[1] > 12.3 && hi[1] < 13.6, `${lod}: the stacks and mast ${hi[1].toFixed(2)} m`);
    assert.ok(hullLo >= -0.31, `${lod}: nothing modelled deep under the water but the wheel (${hullLo.toFixed(2)})`);
    assert.ok(lo[1] < -0.5 && lo[1] > -1.0, `${lod}: the wheel's buckets dip into the water (${lo[1].toFixed(2)} m)`);
    tris[lod] = a.length / VF / 3;
  }
  assert.ok(tris.near > 3 * tris.mid && tris.mid > 2.5 * tris.far, JSON.stringify(tris));
  assert.ok(tris.near <= 16000, `near ${tris.near} tris`);
  assert.ok(tris.mid <= 3000, `mid ${tris.mid} tris`);
  assert.ok(tris.far <= 800, `far ${tris.far} tris`);
  const { runs } = buildPaddleMeshes();
  assert.deepEqual(Object.keys(runs), ['near', 'mid', 'far']);
  assert.equal(runs.mid.first, runs.near.count); assert.equal(runs.far.first, runs.near.count + runs.mid.count);
});

test('the model: a sheer that rises to the bow, a fine entry, the wheel aft of her transom, its buckets in every LOD but the far drum', () => {
  assert.ok(hullSheer(PADDLE.bowZ) > hullSheer(0) + 0.8, 'the sheer rises forward');
  assert.ok(hullSheer(PADDLE.transomZ) > hullSheer(0), 'and a little aft');
  assert.ok(hullHalfBeam(PADDLE.bowZ) < 0.05 && Math.abs(hullHalfBeam(0) - PADDLE.hullBeam / 2) < 1e-9, 'a stem and full sections amidships');
  for (const lod of ['near', 'mid', 'far']) {
    const a = buildPaddle({ lod });
    let n = 0, zmin = Infinity;
    for (let i = 0; i < a.length; i += VF) if (a[i + 6] >= SLOT.wheel) { n++; zmin = Math.min(zmin, a[i + 2]); }
    assert.ok(n > 0, `${lod}: a wheel`);
    assert.ok(zmin > PADDLE.transomZ, `${lod}: the wheel aft of the transom (${zmin.toFixed(2)})`);
  }
});

test('one pipeline, one draw a frame: the LOD for her distance (near within 330 m on the full tier), nothing past the draw distance; the lite tier never takes near and stops at half the distance', async () => {
  for (const tier of ['full', 'lite']) {
    const G = fakeGpu();
    const R = createPaddleRender({ ...G.base, tier });
    assert.equal(await G.reg.buildAll(), 1); assert.deepEqual(G.reg.names(), ['paddle-solid']); assert.deepEqual(G.errors, []);
    const S = createPaddleWheeler({ x: 0, z: 0, headingDeg: 90, kn: 0 });
    const seen = {};
    for (const d of [60, 300, 400, 1400, 1600, 3400, 3600, 6900, 7100]) {
      R.update(S, { eye: [d, 2, 0], heightAt: () => 0 });
      const p = passRec(), c = { calls: 0, triangles: 0 };
      R.draw(p, c);
      seen[d] = R.stats.lod;
      if (R.stats.lod) { assert.equal(p.draws.length, 1, `${tier} ${d} m: one draw`); assert.equal(c.calls, 1); assert.equal(c.triangles, R.mesh.runs[R.stats.lod].count / 3); }
      else assert.equal(p.draws.length, 0, `${tier} ${d} m: none`);
    }
    if (tier === 'full') assert.deepEqual(seen, { 60: 'near', 300: 'near', 400: 'mid', 1400: 'mid', 1600: 'far', 3400: 'far', 3600: 'far', 6900: 'far', 7100: null });
    else assert.deepEqual(seen, { 60: 'mid', 300: 'mid', 400: 'mid', 1400: 'mid', 1600: 'far', 3400: 'far', 3600: null, 6900: null, 7100: null });
  }
  // hysteresis: she holds her LOD a few per cent past the band's edge
  assert.equal(lodFor(LOD_M.near * 1.03, 'near'), 'near'); assert.equal(lodFor(LOD_M.near * 0.97, 'mid'), 'mid'); assert.equal(lodFor(LOD_M.near * 0.9, 'mid'), 'near');
  assert.equal(DRAW_M.lite * 2, DRAW_M.full);
});

// ---- the motion ----
test('under way: she runs along her heading at the set speed; the wheel turns with her speed (about 15 rpm at 8 kn, none stopped), its buckets sweeping aft under her', () => {
  const S = createPaddleWheeler({ x: 100, z: 200, headingDeg: 90, kn: 8 });
  const dt = 1 / 30;
  const a0 = S.boat.wheel;
  for (let i = 0; i < 60 / dt; i++) S.post(dt);
  assert.ok(Math.abs(S.boat.x - (100 + 8 * KN * 60)) < 0.5, `east ${S.boat.x.toFixed(1)}`); assert.ok(Math.abs(S.boat.z - 200) < 1e-6);
  const rpm = S.boat.wheelRate * 60 / (2 * Math.PI);
  assert.ok(rpm > 13 && rpm < 18, `${rpm.toFixed(1)} rpm`);
  assert.ok(Math.abs(wheelRate(8 * KN) * 2 - wheelRate(16 * KN)) < 1e-9, 'the rate in proportion to the speed');
  // the buckets' speed through the water is her speed plus the slip (aft under her: the vertex shader turns them by -angle)
  assert.ok(S.boat.wheelRate * PADDLE.wheel.r > 8 * KN, 'the buckets move faster than she does');
  assert.notEqual(S.boat.wheel, a0);
  const stopped = createPaddleWheeler({ x: 0, z: 0, headingDeg: 0, kn: 0 });
  for (let i = 0; i < 100; i++) stopped.post(dt);
  assert.equal(stopped.boat.wheelRate, 0); assert.equal(stopped.boat.wheel, 0); assert.equal(stopped.boat.v, 0);
  // the trail: a sample every TRAIL_DT s, newest first
  assert.ok(Math.abs(S.trail.length - Math.ceil(40 / TRAIL_DT)) <= 2, `${S.trail.length} samples`);
  assert.ok(S.trail[0].age < S.trail[1].age);
});

test('she eases up from rest like a 300 t hull, and stops short of shoal water ahead', () => {
  const S = createPaddleWheeler({ x: 0, z: 0, headingDeg: 0, kn: 8, settled: false });
  for (let i = 0; i < 300; i++) S.post(0.1);
  assert.ok(S.boat.v > 0.4 * 8 * KN && S.boat.v < 0.6 * 8 * KN, `30 s from rest: ${S.boat.v.toFixed(2)} m/s`);
  // a shore 400 m north: deep water until z -400
  const depthAt = (x, z) => (z < -400 ? 1 : 30);
  const T = createPaddleWheeler({ x: 0, z: 0, headingDeg: 0, kn: 8, depthAt });
  for (let i = 0; i < 3000; i++) T.post(0.1);
  assert.ok(T.boat.stopped, 'stopped');
  assert.ok(T.boat.z > -400 + PADDLE.length / 2, `her bow short of the shoal: ${T.boat.z.toFixed(1)}`);
});

test('floating at the waterline: her pose rides the drawn water\'s mean under her ends and guards, a 46 m hull\'s pitch and roll only a share of its slope; her mesh crosses y 0 all round', () => {
  const G = fakeGpu();
  const R = createPaddleRender({ ...G.base, tier: 'full' });
  const S = createPaddleWheeler({ x: 0, z: 0, headingDeg: 0, kn: 0 });
  R.update(S, { eye: [50, 3, 0], heightAt: () => 0.4 });
  assert.equal(R.stats.y, 0.4);
  const flat = R.pose; assert.ok(Math.abs(flat[5] - 1) < 1e-6 && Math.abs(flat[7] - 0.4) < 1e-6, 'level, at the water');
  // a 1 m swell along her (bow up): pitch a share of the slope
  R.update(S, { eye: [50, 3, 0], heightAt: (x, z) => -z / 34 });
  const pitch = Math.asin(-R.pose[6]);   // row 1, column z (her aft axis's rise)
  assert.ok(Math.abs(pitch) > 0 && Math.abs(pitch) < Math.atan(1 / 34), `pitch ${(pitch * 180 / Math.PI).toFixed(2)}°`);
  // the hull's sheets cross the waterline at every station (nothing floats above it, nothing sinks)
  const a = buildPaddle({ lod: 'mid' });
  let below = 0, above = 0;
  for (let i = 0; i < a.length; i += VF) if (a[i + 6] === SLOT.hull) { if (a[i + 1] < 0) below++; else if (a[i + 1] > 1.5) above++; }
  assert.ok(below > 20 && above > 20, `${below} under, ${above} over`);
});

// ---- the wake and the lights ----
test('her wake: the wheel\'s wide wash, a V and the stem\'s foam while she makes way; nothing at rest', () => {
  const S = createPaddleWheeler({ x: 0, z: 0, headingDeg: 90, kn: 8 });
  for (let i = 0; i < 20 / 0.05; i++) S.post(0.05);
  const focus = { x: S.boat.x, z: S.boat.z, fx: 1, fz: 0 };
  const src = sources(S.emitters(), focus);
  assert.ok(src.kelvin.length > 10 && src.strips.length > 10 && src.noses.length === 1, JSON.stringify({ k: src.kelvin.length, s: src.strips.length, n: src.noses.length }));
  assert.ok(src.strips.some((s) => s[6] >= 7), 'the wheel\'s wash 7 m wide');
  const R = createPaddleWheeler({ x: 0, z: 0, headingDeg: 90, kn: 0 });
  for (let i = 0; i < 100; i++) R.post(0.05);
  const r = sources(R.emitters(), { x: 0, z: 0, fx: 1, fz: 0 });
  assert.equal(r.kelvin.length + r.strips.length + r.noses.length, 0);
});

test('one vessels\' map on the page: hers yields to the glass boat\'s, never clears it, and holds the map between its half-rate runs', async () => {
  const G = fakeGpu();
  const wake = createWakeFx({ ...G.base, creature: 128, vessel: VESSEL.size });
  const tour = createVesselWake({ device: G.device, reg: G.reg, wake });
  const mine = createVesselWake({ device: G.device, reg: G.reg, wake, name: 'paddle-wake' });
  await G.reg.buildAll(); assert.deepEqual(G.errors, []);
  assert.ok(G.reg.names().includes('vessel-wake') && G.reg.names().includes('paddle-wake'));
  const S = createPaddleWheeler({ x: 0, z: 0, headingDeg: 90, kn: 8 });
  for (let i = 0; i < 200; i++) S.post(0.05);
  const focus = { x: S.boat.x, z: S.boat.z, fx: 1, fz: 0 };
  // the glass boat far (her map off every frame), the paddle-wheeler's on: the map stays on through her skipped frames
  for (let f = 0; f < 6; f++) { tour.update(null, null); mine.update(S.emitters(), focus, f); assert.equal(wake.vessel.on, 1, `frame ${f}`); }
  // the glass boat's map live: hers pauses and leaves the switch alone
  wake.vessel.on = 1; mine.pause();
  assert.equal(wake.vessel.on, 1); assert.equal(mine.stats.on, false);
  const p = passRec(), c = { dispatches: 0 }; mine.run(p, c); assert.equal(c.dispatches, 0, 'no dispatch while paused');
});

test('her nav lights at night (masthead, sidelights by sector, stern), none by day', () => {
  const S = createPaddleWheeler({ x: 0, z: 0, headingDeg: 0, kn: 0 });
  const out = new Float32Array(8 * GLOW_FLOATS);
  assert.equal(S.lights(out, 0, { sunElevDeg: 30, eye: [0, 2, -200] }), 0);
  const n = S.lights(out, 0, { sunElevDeg: -12, eye: [0, 2, -200] });   // seen dead ahead: masthead, red and green; not the stern light
  assert.equal(n, 4);
  const rad = Array.from({ length: n }, (_, i) => out[i * GLOW_FLOATS + 7]);
  assert.ok(rad[0] > 0 && rad[1] > 0 && rad[2] > 0, 'masthead and both sidelights ahead'); assert.ok(rad[3] < rad[0] * 0.05, 'no stern light from ahead');
  S.lights(out, 0, { sunElevDeg: -12, eye: [0, 2, 200] });
  assert.ok(out[3 * GLOW_FLOATS + 7] > 0 && out[0 * GLOW_FLOATS + 7] < 1e-3, 'from astern: the stern light, not the masthead');
});

// ---- the policy and the review row ----
const fakeProfile = (win, gpu) => ({ get: () => profileOf(readFacts(win), forcedOf(win.location?.search ?? ''), { gpu }), on: () => () => {} });
const tierOf = (dev, gpu, flags = {}, headless = false, search = '') => createFeatures({ profile: fakeProfile({ ...DEVICES[dev], location: { search } }, gpu), doc: null }).configure({ headless, flags }).feature('paddleWheeler').tier;

test('off in play until routed: no ?paddle=, no boat on any device; placed: full on a desktop or a tablet at L0-L1, lite at L2-L3 and on a phone; a capture full', () => {
  for (const dev of Object.keys(DEVICES)) for (const g of [0, 1, 2, 3]) assert.equal(tierOf(dev, g), 'off', `${dev} L${g}`);
  const flags = { paddle: '11800,-875,95' };
  assert.equal(tierOf('desktop', 0, flags), 'full'); assert.equal(tierOf('desktop', 1, flags), 'full');
  assert.equal(tierOf('desktop', 2, flags), 'lite'); assert.equal(tierOf('ipadPro', 3, flags), 'lite');
  assert.equal(tierOf('iphoneTurned', 1, flags), 'lite'); assert.equal(tierOf('androidSideways', 2, flags), 'lite');
  assert.equal(tierOf('iphoneTurned', 1, flags, true), 'full', 'a capture: the same frame on every machine');
  assert.equal(tierOf('desktop', 0, { paddle: '11800,-875,95' }, true, '?profile=form:phone,gpu:2'), 'lite', 'a forced phone capture: lite');
  assert.equal(tierOf('desktop', 0, { paddle: '0' }), 'off');
  assert.ok(POLICIES.paddleWheeler.why.length > 20);
});

test('the review row: ?paddle=x,z,heading[,kn] parses to a pose (8 kn by default, capped), junk and 0 to none; the plug-in makes nothing without it', async () => {
  assert.deepEqual(parsePaddle('11800,-875,95'), { x: 11800, z: -875, headingDeg: 95, kn: 8 });
  assert.deepEqual(parsePaddle('1,2,3,4.5'), { x: 1, z: 2, headingDeg: 3, kn: 4.5 });
  assert.equal(parsePaddle('1,2,3,99').kn, 14);
  for (const v of [null, '', '0', 'off', 'abc', '5']) assert.equal(parsePaddle(v), null, String(v));
  assert.equal(parseV2Flags('?paddle=11800,-875,95').paddle, '11800,-875,95');
  assert.equal(parseV2Flags('').paddle, null);
  const G = fakeGpu();
  assert.equal(createPaddlePlugin({ ...G.base, flags: {} }), null);
  const P = createPaddlePlugin({ ...G.base, flags: { paddle: '0,0,90,8' }, tier: 'lite' });
  await G.reg.buildAll();
  P.attach({});
  for (let i = 0; i < 30; i++) P.post(1 / 30);
  P.fill([100, 2, 0], 40, { heightAt: () => 0 });
  const p = passRec(), c = { calls: 0, triangles: 0 }; P.draw(p, c);
  assert.equal(p.draws.length, 1); assert.equal(P.stats().render.lod, 'mid', 'lite: the mid LOD near the eye');
  P.fill([100, 2, 0], 40, { heightAt: () => 0, race: true }); const p2 = passRec(); P.draw(p2, { calls: 0, triangles: 0 });
  assert.equal(p2.draws.length, 0, 'a race: not drawn');
});

test('unnamed: no name, no lettering slot, no real boat\'s name in her rows', () => {
  assert.equal(PADDLE.name, null);
  assert.ok(!Object.keys(SLOT).some((k) => /name|text|glyph|letter|logo|livery/i.test(k)), Object.keys(SLOT).join());
  const texts = [POLICIES.paddleWheeler.why, POLICIES.paddleWheeler.aliases, V2_ROWS.find((r) => r.name === 'paddle').doc];
  for (const t of texts) for (const w of ['Queen', 'Dixie', 'Rose', 'Zephyr', 'M.S.', 'Cruises']) assert.ok(!t.includes(w), `${w} in "${t}"`);
});
