// The storm's pure side (v2/sim/storm.js on src/sim/weather/stormSim.js): v1's arc on v2's clock and wind field, the
// uniform rows, the cell's shade at the eye, the water's wind under the outflow, the bolt's mesh within its buffer, the
// rain's count by tier; the render module on a fake device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorm, sunShadeAt, cellMask, boltMesh, boltPaths, BOLT, rainDropsFor, RAIN, stormFromParams, ARC, vnoise } from '../sim/storm.js';
import { createFrameUniforms } from '../engine/uniforms.js';
import { createStormDraw } from '../render/storm.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { createWeatherState } from '../../src/sim/weather/state.js';
import { strikesBetween } from '../../src/sim/weather/stormArc.js';

const field = () => { const w = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, base: { dirDeg: 200, speedMs: 6 } }); w.setTerrain(() => 0); return w; };

test('v1\'s URL rows start the arc on the scene clock; the state follows the phases; the wind field feels the outflow', () => {
  let t = 0;
  const eye = [2300, 2, -1400];
  const S = createStorm({ windField: field(), seed: 1, now: () => t, eye: () => eye, sunDir: () => ({ x: -0.9, y: 0.4, z: -0.175 }), sunElev: () => 23.5, exposure: () => 0.26 });   // the sun as at 18:25: az 281°, 23.5° up
  const p = stormFromParams({ weather: 'storm', stormt: '150', stormref: '2300,-1400' });
  assert.deepEqual(p, { s0: 150, rate: 1, ref: [2300, -1400] });
  assert.equal(stormFromParams({}), null);
  S.begin(); S.start({ s0: p.s0, rate: p.rate, ref: p.ref, t0: 0 });
  const info = S.update(18.25);
  assert.equal(info.phase, 'storm'); assert.ok(info.rain > 0.9, `rain at the peak: ${info.rain}`); assert.ok(info.dark > 0.9);
  assert.equal(S.weather.on, 1); assert.ok(S.weather.cell[2] > 4000, 'a wide cell at the peak');
  const base = { speedMs: 6, dirDeg: 200, travelRad: 0 }, out = {};
  S.waterWind(base, out);
  assert.ok(out.gain > 1.2 && out.gain < 2.2, `the outflow raises the wind at the eye: × ${out.gain.toFixed(2)}`);
  assert.ok(Math.abs(out.speedMs - 6 * out.gain) < 1e-9);
  assert.ok(out.dirDeg > 200 && out.dirDeg < 250, `veered toward 250: ${out.dirDeg.toFixed(1)}`);
  // the clearing: the rain gone, the gold up, the rainbow possible with the sun low behind the viewer
  t = 90;   // arc second 240
  const info2 = S.update(18.25);
  assert.equal(info2.phase, 'clear'); assert.ok(info2.rain < 0.05); assert.ok(info2.gold > 0.5);
  assert.ok(info2.rainbow > 0.5, `the rainbow at 240 s with the sun 23.5° up in the WNW and the cell gone ENE: ${info2.rainbow}`);
  // the end: the state back to fair
  t = ARC.end - 150 + 1;
  S.update(18.25);
  assert.equal(S.running, false); assert.equal(S.weather.on, 0); assert.equal(S.weather.rain, 0);
  S.waterWind(base, out); assert.equal(out.gain, 1); assert.equal(out.dirDeg, 200);
});

test('the uniform rows carry the state; off, every row is 0 and the shade is 1', () => {
  const U = createFrameUniforms(); U.begin();
  let t = 0;
  const S = createStorm({ windField: field(), seed: 1, now: () => t, eye: () => [0, 2, 0], sunDir: () => ({ x: 0, y: 1, z: 0 }), sunElev: () => 60, exposure: () => 0.26 });
  S.begin(); S.update(14);
  assert.equal(S.fillFrame(U, [0, 2, 0]), 1);
  const o = U.layout.offsets;
  for (const f of ['storm', 'rain', 'cell', 'front', 'bow']) for (let i = 0; i < 4; i++) if (!(f === 'storm' && i === 1) && !(f === 'cell' && i === 2) && !(f === 'bow' && i === 0)) assert.equal(U.view[o[f] + i], 0, `${f}[${i}] off`);   // the cell's radius and toRain keep their rest values (v1's state does too)
  assert.equal(U.view[o.storm + 1], 1, 'no shade');
  S.start({ s0: 165, ref: [0, 0], t0: 0 });
  const shade = S.fillFrame(U, [0, 2, 0]);
  S.update(14); S.fillFrame(U, [0, 2, 0]);
  assert.equal(U.view[o.storm], 1, 'on');
  assert.ok(U.view[o.storm + 1] < 0.2, `under the cell's core the sun is shaded: ${U.view[o.storm + 1]}`);
  assert.ok(U.view[o.rain] > 0.9 && U.view[o.cell + 2] > 4000 && U.view[o.bow + 3] === 0, 'the rain, the cell, the arc\'s time');
  void shade;
});

test('the cell\'s shade: 1 far from the cell, ≈ 0.08 under its core, the gaps open it in the clearing; the mask is v1\'s', () => {
  const W = createWeatherState();
  W.on = 1; W.cell = [0, 0, 3000]; W.cover = 1; W.shade = 1; W.gaps = 0; W.sun = [0, 1, 0];
  assert.ok(Math.abs(sunShadeAt(0, 0, 0, W) - 0.08) < 1e-6);
  assert.equal(sunShadeAt(20000, 0, 0, W), 1);
  assert.ok(Math.abs(cellMask(0, 0, W) - 1) < 1e-9 && cellMask(3000, 0, W) === 0);
  assert.ok(cellMask(-2500, 900, W) > cellMask(2500, -900, W), 'the trailing (upwind) side is stretched');
  W.gaps = 1;
  let open = 0; for (let i = 0; i < 100; i++) if (sunShadeAt(i * 150, 0, i * 97, W) > 0.5) open++;
  assert.ok(open > 10 && open < 90, `gaps let the sun through in places: ${open} of 100`);
  W.on = 0; assert.equal(sunShadeAt(0, 0, 0, W), 1);
  assert.ok(Math.abs(vnoise(0.5, 0.5)) <= 1 && vnoise(3, 4) === vnoise(3, 4));
});

test('the bolt\'s channel: from the cloud base to the ground, inside the vertex cap, deterministic by the strike\'s seed', () => {
  const strikes = strikesBetween(1, 120, 140, [2300, -1400]).filter((k) => k.bolt);
  assert.ok(strikes.length >= 1);
  for (const k of strikes) {
    const paths = boltPaths(k, 10);
    assert.ok(paths[0].pts[0][1] > 2000 && paths[0].pts.at(-1)[1] === 10, 'top to ground');
    const m = boltMesh(k, 10);
    assert.ok(m.nv > 100 && m.nv <= BOLT.maxVerts && m.ni <= BOLT.maxVerts * 3 && m.ni % 3 === 0, `${m.nv} vertices, ${m.ni} indices`);
    for (let i = 0; i < m.ni; i++) assert.ok(m.index[i] < m.nv, 'every index names a vertex');
    const again = boltMesh(k, 10);
    assert.deepEqual(Array.from(again.verts.subarray(0, m.nv * 8)), Array.from(m.verts.subarray(0, m.nv * 8)), 'the same channel every time');
  }
  assert.equal(rainDropsFor(2e6), RAIN.desktop); assert.equal(rainDropsFor(0.3e6), RAIN.phone);
});

test('the render module on a fake device: two pipelines at load, the drop count follows the rain, a new strike writes the bolt once', () => {
  const made = { pipelines: [], writes: 0 };
  const device = { createBuffer: ({ size }) => ({ size }), createBindGroupLayout: () => ({}), createBindGroup: () => ({}), createPipelineLayout: () => ({}), queue: { writeBuffer: () => { made.writes++; } } };
  const reg = { shader: () => ({}), add: (n) => made.pipelines.push(n) };
  const D = createStormDraw({ device, reg, frameBGL: {}, frameBG: {}, U: {}, frameStruct: 'struct Frame { a: vec4f }', sky: { skyBGL: {} }, hdrTarget: { format: 'rgba16float' }, pixels: 2e6 });
  assert.deepEqual(made.pipelines, ['storm-rain', 'storm-bolt']);
  D.update({ rain: 0.5, t: 1 }); assert.equal(D.stats.drops, RAIN.desktop / 2);
  D.update({}); assert.equal(D.stats.drops, 0);
  const k = strikesBetween(1, 120, 140, [2300, -1400]).find((s) => s.bolt);
  const w0 = made.writes;
  D.update({ strike: k, flash: 0.8, groundY: 5 }); assert.equal(D.stats.bolt, k.id); assert.equal(D.stats.builds, 1);
  D.update({ strike: k, flash: 0.4, groundY: 5 }); assert.equal(D.stats.builds, 1, 'the same strike: no rebuild');
  assert.ok(made.writes > w0);
  D.update({ strike: k, flash: 0 }); assert.equal(D.stats.boltGlow, 0);
});

//, 2026-11-17): a phone's storm keeps the rain and the flash, not the bolt's channel
test('bolts: false (a phone): one pipeline, the rain as ever, a strike builds and draws nothing', () => {
  const made = { pipelines: [], buffers: [], draws: 0 };
  const device = { createBuffer: ({ label, size }) => { made.buffers.push(label); return { size }; }, createBindGroupLayout: () => ({}), createBindGroup: () => ({}), createPipelineLayout: () => ({}), queue: { writeBuffer: () => {} } };
  const reg = { shader: () => ({}), add: (n) => made.pipelines.push(n), get: (n) => n };
  const D = createStormDraw({ device, reg, frameBGL: {}, frameBG: {}, U: {}, frameStruct: 'struct Frame { a: vec4f }', sky: { skyBGL: {} }, hdrTarget: { format: 'rgba16float' }, pixels: 2e6, bolts: false });
  assert.deepEqual(made.pipelines, ['storm-rain']);
  assert.ok(!made.buffers.some((l) => /bolt/.test(l)), made.buffers.join(', '));
  const k = strikesBetween(1, 120, 140, [2300, -1400]).find((s) => s.bolt);
  D.update({ rain: 0.5, t: 1, strike: k, flash: 0.8, groundY: 5 });
  assert.equal(D.stats.drops, RAIN.desktop / 2); assert.equal(D.stats.builds, 0); assert.equal(D.stats.boltGlow, 0);
  const pass = { setBindGroup() {}, setPipeline(p) { made.last = p; }, draw() { made.draws++; }, drawIndexed() { throw new Error('a bolt drawn'); }, setVertexBuffer() {}, setIndexBuffer() {} };
  D.draw(pass, { calls: 0, triangles: 0 }, { skyBG: {} });
  assert.equal(made.draws, 1, 'the rain drawn'); assert.equal(made.last, 'storm-rain');
});

test('#18 r2: the storm fog is v1\'s valley mist (FOG_A, FOG_B) and its storm gain (src/weather/storm.js: 1 + 22 × haze)', async () => {
  const { STORM_FOG } = await import('../render/sky.js');
  const { FOG_A, FOG_B } = await import('../../src/sim/core/params.js');
  assert.equal(STORM_FOG.a, FOG_A); assert.equal(STORM_FOG.b, FOG_B); assert.equal(STORM_FOG.gain, 22);
  const { FAR_LOOK } = await import('../../classic/src/core/farLook.js'); assert.equal(STORM_FOG.mistK, FAR_LOOK.mistK);
});

