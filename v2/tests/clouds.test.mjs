// The clouds (M5a, v2/sim/clouds.js + v2/render/clouds.js): the key's direction mapping, the amortised bake schedule,
// the drift from the shared wind, the params record, the JS twins of the WGSL noise (tileable, deterministic, the
// stretch bounds against the percentiles), the density algebra, and the guard: every cloud pipeline is declared at
// load, none after the registry is sealed, and the frame's dispatch covers exactly this frame's rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DECK, KEY, keySizeFor, dirToKeyUV, keyUVToDir, createKeySchedule, cloudDrift, fillParams, PARAM_FLOATS, createWeatherState,
  hash3, perlin, worley, shapeRaw, detailRaw, weatherRaw, STRETCH, stretch, cloudDensity, phase, cloudLightMatch, LIGHT_MATCH, LIGHT_MATCH_V2 } from '../sim/clouds.js';
import { createClouds, keyMips, KEY_WGSL, NOISE_BAKE_WGSL, WEATHER_BAKE_WGSL } from '../render/clouds.js';
import { CLOUD_READ } from '../render/cloud-read.js';
import { setLook } from '../sim/exposure.js';
import { TWILIGHT } from '../render/grade.js';
import { SKY_READ } from '../render/sky.js';
import { createPipelineRegistry } from '../engine/pipelines.js';
import { CLOUD_DECK } from '../../src/sim/core/params.js';
import { WEATHER } from '../../src/sim/weather/weatherMenu.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);

test('the deck is v1\'s (src/sim/core/params.js CLOUD_DECK) but a clearer default cover; the key is the phone\'s under 0.6 Mpx', () => {
  for (const k of ['type', 'base', 'thickness']) assert.equal(DECK[k], CLOUD_DECK[k], k);
  // (owner, 2026-11-19): the default sky clearer than v1's Fair, still with clouds, Clear's below it
  assert.ok(DECK.coverage < CLOUD_DECK.coverage && DECK.coverage > WEATHER.clear, `default cover ${DECK.coverage}`);
  assert.deepEqual(keySizeFor(390 * 844), KEY.phone); assert.deepEqual(keySizeFor(1280 * 720), KEY.desktop); assert.deepEqual(keySizeFor(2560 * 1600), KEY.desktop);
  assert.ok(KEY.desktop[0] % 8 === 0 && KEY.desktop[1] % 8 === 0 && KEY.phone[0] % 8 === 0, 'multiples of the 8 × 8 workgroup');
});

test('key mapping: the horizon is row 0, the zenith the last row, azimuth wraps, and it round-trips', () => {
  assert.deepEqual(dirToKeyUV([1, 0, 0]).map((x) => +x.toFixed(6)), [0.5, 0]);
  near(dirToKeyUV([0, 1, 0])[1], 1, 1e-9, 'zenith');
  near(dirToKeyUV([0, -0.5, 0.866])[1], 0, 1e-9, 'below the horizon clamps to row 0');
  near(dirToKeyUV([0, 0, 1])[0], 0.75, 1e-9, 'south (+z) at u = 0.75'); near(dirToKeyUV([0, 0, -1])[0], 0.25, 1e-9, 'north at 0.25');
  for (let u = 0.02; u < 1; u += 0.13) for (let v = 0.05; v < 1; v += 0.17) {
    const d = keyUVToDir(u, v), [u2, v2] = dirToKeyUV(d);
    near(u2, u, 1e-9, 'u'); near(v2, v, 1e-9, 'v'); near(Math.hypot(...d), 1, 1e-9, 'unit');
  }
  // the sqrt warp packs the texels at the horizon: the first 10 % of the rows cover 0.9°, the last 10 % cover 17°
  const e = (v) => keyUVToDir(0.5, v)[1];
  assert.ok(Math.asin(e(0.1)) * 180 / Math.PI < 1 && (Math.asin(e(1)) - Math.asin(e(0.9))) * 180 / Math.PI > 15);
});

test('the schedule: every row once a cycle, a swap when whole, the fade 0 → 1 over the next cycle, three layers rotated', () => {
  const rows = 512, s = createKeySchedule({ rows, cycleFrames: 60 });
  assert.equal(s.state.perFrame, 9);
  const first = s.step(true);   // the first frame: the whole key, swapped at once
  assert.equal(first.rows, rows); assert.equal(first.row0, 0); assert.ok(first.swapped); assert.equal(first.cur, first.prev, 'no older key to fade from');
  assert.equal(first.layer, first.cur, 'the layer just written is the one read');
  const baked = new Set(); let swaps = 0, lastFade = -1, frames = 0;
  const written = first.layer;
  for (let i = 0; i < 57; i++) {
    const r = s.step(); frames++;
    if (!r.swapped) { assert.notEqual(r.layer, r.cur, 'never writes the layer being read'); assert.notEqual(r.layer, r.prev, 'nor the one fading out'); }
    for (let k = r.row0; k < r.row0 + r.rows; k++) { assert.ok(!baked.has(k), `row ${k} twice`); baked.add(k); }
    if (r.swapped) { swaps++; assert.equal(baked.size, rows, 'swapped when every row is in'); assert.equal(r.cur, r.layer); assert.equal(r.prev, written); assert.equal(r.fade, 0, 'the read starts on the old key'); }
    else { assert.ok(r.fade >= lastFade, 'fade never goes back'); assert.ok(r.fade < 1); }
    lastFade = r.swapped ? 0 : r.fade;
  }
  assert.equal(swaps, 1); assert.equal(frames, 57, 'ceil(512 / 9) = 57 frames a cycle');
  assert.equal(baked.size, rows);
  // the second cycle: the fade climbs toward 1 as the next key fills; the third layer comes into use
  const layers = new Set();
  for (let i = 0; i < 57; i++) { const r = s.step(); layers.add(r.layer); if (i === 56) { assert.ok(r.swapped); } else near(r.fade, (i + 1) * 9 / rows, 1e-9, 'fade is the next bake\'s progress'); }
  assert.equal(s.state.cycles, 3);
  assert.throws(() => createKeySchedule({ rows: 0 }));
});

test('the drift rides the shared wind at 1.5 × its speed, toward where it blows', () => {
  const w = cloudDrift(5, 270, 1);   // a west wind blows toward +x (east)
  near(w[0], 7.5, 1e-9); near(w[1], 0, 1e-9);
  const n = cloudDrift(4, 0, 10);    // a north wind blows toward +z (south)
  near(n[0], 0, 1e-9); near(n[1], 60, 1e-9);
  const z = cloudDrift(6, 123, 0); near(z[0], 0, 1e-12); near(z[1], 0, 1e-12);
});

test('the params record: 32 floats, the schedule and the deck in their slots, the storm cell and its towers only while a storm is on', () => {
  const out = new Float32Array(PARAM_FLOATS);
  const w = createWeatherState(); w.cell = [1200, -900, 3000]; w.cover = 0.8; w.slab = 2500; w.shade = 0.6;
  w.shelfDrop = 460; w.under = 700; w.rainCore = 0.9; w.tall = 0.7;
  fillParams(out, { cur: 2, prev: 1, fade: 0.25, on: 1, drift: [10, -20], t: 3, row0: 27, layer: 0, weather: w, seed: 7, night: 0.5 });
  assert.deepEqual(Array.from(out.subarray(0, 4)), [2, 1, 0.25, 1]);
  assert.deepEqual(Array.from(out.subarray(4, 8)), [DECK.coverage, DECK.type, DECK.base, DECK.thickness].map(Math.fround));
  assert.deepEqual(Array.from(out.subarray(8, 12)), [10, -20, 3, 27]);
  assert.deepEqual(Array.from(out.subarray(12, 16)), [1200, -900, 3000, 0], 'off: no cover');
  assert.equal(out[16], 0); assert.equal(out[17], 0); near(out[18], DECK.density, 1e-7); assert.equal(out[19], 0);
  assert.equal(out[20], 7); assert.equal(out[21], 0.5);
  assert.equal(PARAM_FLOATS, 32);
  assert.deepEqual(Array.from(out.subarray(28, 32)), [0, 0, 0, 0], 'off: no towers');
  assert.deepEqual(Array.from(out.subarray(24, 28)), [1, 1, 1, 0], 'no light match given: v2\'s own light');
  fillParams(out, { match: [1.5, 9, 0.5] });
  assert.deepEqual(Array.from(out.subarray(24, 28)), [1.5, 9, 0.5, 0]);
  w.on = 1; fillParams(out, { weather: w });
  near(out[15], 0.8, 1e-6); assert.equal(out[16], 2500); near(out[17], 0.6, 1e-6);
  near(out[28], w.dir[0], 1e-6); near(out[29], w.dir[1], 1e-6); assert.equal(out[30], 0); near(out[31], 0.7, 1e-6);   // on: the cell's drift (storm round 2)
  fillParams(out, { weather: { ...createWeatherState(), cell: [0, 0, 0] } });
  assert.equal(out[14], 1, 'a zero radius is clamped to 1 m');
});

test('the noise twins: the hash is in [0, 1) and seeded; Perlin and Worley tile at their period; the shape and detail are in 0..1', () => {
  const h = hash3(3, 5, 7, 1);
  assert.ok(h >= 0 && h < 1); assert.equal(h, hash3(3, 5, 7, 1)); assert.notEqual(h, hash3(3, 5, 7, 2)); assert.notEqual(h, hash3(5, 3, 7, 1));
  for (const p of [4, 8, 16]) for (const [x, y, z] of [[0.3, 1.7, 2.2], [3.9, 0.1, 1.5]]) {
    near(perlin(x, y, z, p, 3), perlin(x + p, y, z, p, 3), 1e-9, 'perlin tiles in x'); near(perlin(x, y, z, p, 3), perlin(x, y + p, z - p, p, 3), 1e-9, 'and in y, z');
    near(worley(x, y, z, p, 9), worley(x + p, y - p, z, p, 9), 1e-9, 'worley tiles');
  }
  let lo = 1, hi = 0, mean = 0, n = 0;
  for (let i = 0; i < 2000; i++) { const x = (i * 0.618034) % 4, y = (i * 0.414214) % 4, z = (i * 0.732051) % 4; const w = worley(x, y, z, 4, 1); lo = Math.min(lo, w); hi = Math.max(hi, w); mean += perlin(x, y, z, 4, 1); n++; }
  assert.ok(lo >= 0 && hi <= 1 && hi > 0.8, `worley spans 0..1: ${lo} ${hi}`);
  assert.ok(Math.abs(mean / n) < 0.1, 'perlin has zero mean');
  for (const [x, y, z] of [[0.1, 0.2, 0.3], [0.7, 0.9, 0.4], [0.5, 0.5, 0.5]]) {
    const s = shapeRaw(x, y, z, 1), d = detailRaw(x, y, z, 1), [c, t] = weatherRaw(x, y, 1);
    assert.ok(s >= 0 && s <= 1 && d >= 0 && d <= 1, 'raw ranges'); assert.ok(Math.abs(c) < 1.6 && Math.abs(t) < 1.6);
  }
  // the fixed stretch bounds (v1 stretched the 1st..99th percentiles): within 0.06 of a 20³ sample's percentiles
  const S = 20, sh = [], de = [];
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { sh.push(shapeRaw(x / S, y / S, z / S, 1)); de.push(detailRaw(x / S, y / S, z / S, 1)); }
  const pct = (a, q) => { const s = Float64Array.from(a).sort(); return s[Math.floor(s.length * q)]; };
  near(pct(sh, 0.01), STRETCH.shape[0], 0.06, 'shape 1 %'); near(pct(sh, 0.99), STRETCH.shape[1], 0.06, 'shape 99 %');
  near(pct(de, 0.01), STRETCH.detail[0], 0.06, 'detail 1 %'); near(pct(de, 0.99), STRETCH.detail[1], 0.06, 'detail 99 %');
  assert.equal(stretch(STRETCH.shape[0] - 1, STRETCH.shape), 0); assert.equal(stretch(2, STRETCH.shape), 1); near(stretch(0.825, [0.73, 0.92]), 0.5, 1e-9);
});

test('the density algebra: no cloud outside the slab or at coverage 0; coverage fills it; type lifts the top; the detail erodes', () => {
  const base = { shape: 0.9, detail: 0.5, wR: 0.5, wG: 0.5, h: 0.25, coverage: 0.6, type: 0.35 };   // type 0.35 tops out at 55 % of the slab
  assert.equal(cloudDensity({ ...base, h: 0.6 }), 0, 'above the deck\'s own top');
  assert.equal(cloudDensity({ ...base, h: 0 }), 0); assert.equal(cloudDensity({ ...base, h: 1 }), 0);
  assert.equal(cloudDensity({ ...base, coverage: 0 }), 0);
  const d6 = cloudDensity(base), d9 = cloudDensity({ ...base, coverage: 0.9 });
  assert.ok(d6 > 0 && d9 > d6, `coverage fills: ${d6} ${d9}`);
  assert.equal(cloudDensity({ ...base, type: 0, h: 0.8 }), 0, 'a stratus sheet tops out at 30 %');
  assert.ok(cloudDensity({ ...base, type: 1, h: 0.8, coverage: 0.9 }) > 0, 'a cumulus tower reaches 80 %');
  assert.ok(cloudDensity({ ...base, detail: 1 }) > cloudDensity({ ...base, detail: 0 }), 'billowy above: a high detail erodes less');
  assert.ok(cloudDensity({ ...base, h: 0.1, detail: 0 }) >= cloudDensity({ ...base, h: 0.1, detail: 1 }), 'wispy under: inverted');
  assert.ok(cloudDensity({ ...base, coverage: 0.2 }) === 0 && cloudDensity({ ...base, coverage: 0.2, cell: 1, cellCover: 0.6 }) > 0, 'the storm cell lifts the coverage');
  assert.ok(phase(1) > phase(0) && phase(0) > phase(-1) * 0.5 && phase(-1) >= 0.1, 'a forward lobe, a back lobe, a floor');
});

// a fake device: enough of WebGPU for createClouds to declare its resources and pipelines without a GPU
function fakeDevice() {
  const calls = { pipelines: [], dispatches: [], writes: 0 };
  const view = () => ({ view: true });
  return {
    calls,
    createTexture: (d) => ({ ...d, createView: view }),
    createSampler: () => ({}), createBuffer: (d) => ({ size: d.size }),
    createBindGroupLayout: (d) => ({ entries: d.entries }), createBindGroup: (d) => ({ entries: d.entries }), createPipelineLayout: (d) => d,
    createShaderModule: ({ label, code }) => ({ label, code, getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipelineAsync: async (d) => { calls.pipelines.push(d.label); return { label: d.label }; },
    createRenderPipelineAsync: async (d) => ({ label: d.label }),
    createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups(...a) { calls.dispatches.push(a); }, end() {} }), finish: () => ({}) }),
    queue: { writeBuffer: () => { calls.writes++; }, submit() {} },
    pushErrorScope() {}, popErrorScope: async () => null,
  };
}

test('the guard: five pipelines at load (the speed pass: + the blend; the far water\'s shimmer fix: + the blended layer\'s mip chain), none after seal; the first frame bakes the whole key, then a band of rows; a cut re-bakes it', async () => {
  const errors = [], dev = fakeDevice(), reg = createPipelineRegistry(dev, { errors });
  const U = { byteOffset: 0 };
  const cl = createClouds({ device: dev, reg, frameBGL: {}, frameBG: {}, U, frameStruct: 'struct Frame { x: vec4f }', pixels: 1280 * 720, seed: 3 });
  const sky = { textures: { tT: { createView: () => ({}) }, tV: { createView: () => ({}) } }, samplers: { sLin: {}, sView: {} }, lightBuf: {} };
  cl.attach(sky);
  assert.equal(await reg.buildAll(), 5); assert.deepEqual(reg.names(), ['cloud-noise', 'cloud-weather', 'cloud-blend', 'cloud-key-mip', 'cloud-key']);
  cl.bakeOnce(); cl.bakeOnce();
  assert.deepEqual(dev.calls.dispatches, [[16, 16, 16], [32, 32]], 'the 64³ noise and the 256² weather, once');
  reg.seal();
  const [W, H] = cl.size, c = { dispatches: 0 }, pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups(...a) { dev.calls.dispatches.push(a); } };
  const wind = { speedMs: 5, dirDeg: 270 };
  const st = cl.update({ wind, t: 2, eye: [0, 1.6, 0] });
  assert.equal(st.rows, H, 'the first frame: every row');
  cl.run(pass, c);
  // the far water's shimmer fix: after the blend, the blended layer's mip chain, level by level down to one row
  const mips = keyMips(H), chain = Array.from({ length: mips - 1 }, (_, l) => [Math.ceil((W >> (l + 1)) / 8), Math.ceil((H >> (l + 1)) / 8)]);
  assert.equal(mips, 10);
  assert.deepEqual(dev.calls.dispatches.slice(-2 - chain.length), [[W / 8, H / 8], [W / 8, H / 8], ...chain], 'the march, the blend over the whole key, its chain');
  assert.equal(cl.params[11], 0); assert.equal(cl.params[22], H); assert.equal(cl.params[8], 15, 'the drift: 5 m/s × 1.5 × 2 s east'); assert.equal(cl.params[20], 3, 'the seed');
  const st2 = cl.update({ wind, t: 2.1, eye: [1, 1.6, 0] });
  assert.equal(st2.rows, cl.schedule.state.perFrame); cl.run(pass, c);
  assert.deepEqual(dev.calls.dispatches.slice(-2 - chain.length), [[W / 8, Math.ceil(cl.schedule.state.perFrame / 8)], [W / 8, H / 8], ...chain], 'every frame: the blend changes, so its chain is re-made');
  const st3 = cl.update({ wind, t: 2.2, eye: [500, 1.6, 0] });   // a cut: the eye jumped 500 m
  assert.equal(st3.rows, H); assert.equal(cl.stats.full, 2);
  cl.set(false); assert.equal(cl.update({ wind, t: 2.3, eye: [500, 1.6, 0] }), null); const n = dev.calls.dispatches.length; cl.run(pass, c); assert.equal(dev.calls.dispatches.length, n, 'off: no march');
  assert.equal(cl.params[3], 0, 'the readers see on = 0');
  assert.equal(reg.late, 0); assert.deepEqual(errors, []);
  assert.equal(c.dispatches, 4 + 2 * (mips - 1));
});

test('the WGSL carries the key\'s size and the march\'s constants; the readers bind 7, 8, 9 of the sky-read group', () => {
  const k = KEY_WGSL('struct Frame { x: vec4f }', KEY.desktop);
  assert.ok(k.includes(`const W = ${KEY.desktop[0]}.0; const H = ${KEY.desktop[1]}.0; const N = ${KEY.steps}; const NL = ${KEY.lightSteps};`));
  assert.ok(k.includes(`const SHAPE_M = ${KEY.shapeM}.0; const DETAIL_M = ${KEY.detailM}.0; const WEATHER_M = ${KEY.weatherM}.0; const MAXD = ${KEY.maxDistance}.0;`));
  for (const [lo, hi] of [STRETCH.shape, STRETCH.detail]) assert.ok(NOISE_BAKE_WGSL.includes(`${lo}, ${hi}`), 'the bake uses the tested stretch bounds');
  assert.ok(WEATHER_BAKE_WGSL.includes(`${STRETCH.weather[0]}, ${STRETCH.weather[1]}`));
  const r = CLOUD_READ(1);
  for (const b of [7, 8, 9]) assert.ok(r.includes(`@group(1) @binding(${b})`), `binding ${b}`);
  assert.ok(SKY_READ.includes('fn cloudAt(') && SKY_READ.includes('fn skyWithClouds(') && SKY_READ.includes('fn cloudDistKm('), 'every scene shader can read the deck');
});

test('the cloud light as v1\'s camera shows it: the fitted gains at noon, less toward dusk, none at night or in a storm\'s dark', () => {
  const noon = cloudLightMatch(73.8);
  near(noon[0], LIGHT_MATCH.sun, 1e-9); near(noon[1], LIGHT_MATCH.sky, 1e-9); near(noon[2], LIGHT_MATCH.chroma, 1e-9);
  assert.ok(LIGHT_MATCH.sky > Math.PI, 'the sky light is at least v1\'s E (π × the old E / π)');
  // fix(v2) frame look: under v1's camera both exposures follow v1's schedule, so the match holds all day and fades only under the sun's 10°
  const dusk = cloudLightMatch(17.8), late = cloudLightMatch(5);
  assert.deepEqual(dusk, noon, 'the 18:45 sun: noon\'s gains (v1\'s exposure on both)'); assert.ok(late[1] < dusk[1], 'fading under 10°');
  // ?look=v2: the ACES camera and its match (M2 adapts toward dusk, v1 holds its base)
  setLook('v2');
  try {
    const n2 = cloudLightMatch(73.8), d2 = cloudLightMatch(17.8), l2 = cloudLightMatch(9.5);
    near(n2[0], LIGHT_MATCH_V2.sun, 1e-9); near(n2[1], LIGHT_MATCH_V2.sky, 1e-9);
    assert.ok(d2[0] < n2[0] && d2[1] < n2[1] && l2[1] < d2[1], `v2 adapts toward dusk, v1 holds its base: ${n2[1]} > ${d2[1]} > ${l2[1]}`);
  } finally { setLook('v1'); }
  for (const e of [-12, -20]) assert.deepEqual(cloudLightMatch(e), [1, 1, 1], `night (${e}°): v2's own look`);
  //: the twilight lifts the deck's sky light with the drawn sky (render/grade.js TWILIGHT), the sun's and the chroma's untouched
  const tw = cloudLightMatch(-4.4);
  near(tw[1], TWILIGHT.cloudSky, 1e-9, 'the blue hour\'s deck'); assert.equal(tw[0], 1); assert.equal(tw[2], 1);
  assert.ok(cloudLightMatch(-5.8)[1] > 1 && cloudLightMatch(-5.8)[1] < TWILIGHT.cloudSky, 'fading toward the night');
  for (let e = -6; e <= 80; e += 2) { const m = cloudLightMatch(e); assert.ok(m[1] <= LIGHT_MATCH.sky + 1e-9 && m[0] <= LIGHT_MATCH.sun + 1e-9, `never above noon's gains (${e}°)`); }
  const w = createWeatherState(); w.on = 1; w.dark = 1; w.cover = 1;
  assert.deepEqual(cloudLightMatch(73.8, w), noon, '#18 r2: a storm keeps v1\'s camera (the match no longer fades under it)');
});

test('round 2: the drawn sky lifted through the blue hour, darker past it, the night\'s dim held', async () => {
  const { skyMatchStrength, TWILIGHT } = await import('../render/grade.js');
  assert.ok(skyMatchStrength(-4.4) >= TWILIGHT.sky - 1e-9, 'the blue hour (20:51) keeps the lift');
  assert.ok(skyMatchStrength(-5.8) > 0 && skyMatchStrength(-5.8) < TWILIGHT.sky, 'easing out after the blue hour');
  for (const e of [-10, -14, -18.4]) assert.ok(Math.abs(skyMatchStrength(e) + (1 - TWILIGHT.night)) < 1e-9, `the night (${e}°): the sky at ${TWILIGHT.night} × its own`);
  for (let e = -12; e <= 10; e += 0.25) assert.ok(Math.abs(skyMatchStrength(e + 0.25) - skyMatchStrength(e)) < 0.3, `no jump at ${e}°`);
});
