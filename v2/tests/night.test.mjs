// The night's pure side (v2/sim/night.js): the levels from the sun and the moon (v1's fades), the night exposure, the
// packed lights' and stars' decoders against the shipped files and the pack tool, the boat's nav lights in the world
// (COLREGs sectors toward the eye), and the render module's record on a fake device (no GPU).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NIGHT, nightLevels, decodeLights, decodeStars, navLights, GLOW_FLOATS, LIGHT_FLOATS, STAR_FLOATS, nightFade, isNight, nightLoadDue } from '../sim/night.js';
import { exposureFactor, nightGain, NIGHT_GAIN } from '../sim/exposure.js';
import { packLights, LIGHT_BYTES, HEADER_BYTES } from '../../tools/v2-lights-pack.mjs';
import { createNight, CAPS, GLOW } from '../render/night.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the levels: nothing by day, the airglow in from the sunset (full by −8°), the band from −10° (full by −18°); the moon lifts the sky and dims the band', () => {
  const day = nightLevels({ sunElevDeg: 30 });
  assert.deepEqual([day.air, day.domes, day.band, day.k], [0, 0, 0, 0]);
  const dusk = nightLevels({ sunElevDeg: -4 });
  assert.ok(dusk.air > 0.4 && dusk.air < 0.6, `the airglow half way at −4°: ${dusk.air}`);
  assert.equal(nightLevels({ sunElevDeg: 0.5 }).air, 0, 'none before the sunset'); assert.equal(nightLevels({ sunElevDeg: -8 }).air, 1, 'full by −8°, where the sky goes black');
  assert.equal(nightLevels({ sunElevDeg: -8 }).band, 0, 'no band at −8°');
  assert.equal(dusk.band, 0, 'no band before astronomical twilight');
  const night = nightLevels({ sunElevDeg: -20 });
  assert.equal(night.air, 1); assert.equal(night.band, 1); assert.equal(night.k, 1);
  const moon = nightLevels({ sunElevDeg: -20, moonAltDeg: 40, moonLit: 1 });
  assert.ok(Math.abs(moon.air - (1 + NIGHT.moonSky)) < 1e-9, 'a full moon high lifts the airglow by 1 + moonSky');
  assert.ok(moon.band < 0.11 && moon.band > 0.09, `and leaves 10 % of the band: ${moon.band}`);
  assert.ok(Math.abs(moon.moonShare - 1) < 1e-9);
  const thin = nightLevels({ sunElevDeg: -20, moonAltDeg: 40, moonLit: 0.1 });
  assert.ok(thin.band > 0.9, 'a thin crescent leaves nearly all of it');
  assert.equal(nightFade(-10), 0); assert.equal(nightFade(-18), 1);
  // the theme's switch (src/ui/theme.js): night under −1°, day back over +1°, with hysteresis
  assert.equal(isNight('auto', -1.5), true); assert.equal(isNight('auto', 0, true), true); assert.equal(isNight('auto', 1.5, true), false);
});

test('the night exposure: continuous from dusk to deep night, × NIGHT_GAIN by −8°, exposed down under the moon only at night', () => {
  let prev = exposureFactor(6, 10);
  for (let e = 10; e >= -25; e -= 0.1) { const f = exposureFactor(6, e); assert.ok(f >= prev - 1e-12, `never darker as the sun sinks (${e}°)`); assert.ok(f / prev < 1.06, `no step at ${e}°: ${(f / prev).toFixed(3)}`); prev = f; }   // look/v2-night-look: up to 1.055 per 0.1° from +3.5° to the sunset (1.7 real s a 0.1° at 20 game s a real s; 1.17 × in 5 real s)
  assert.ok(Math.abs(nightGain(-8) - NIGHT_GAIN) < 1e-9 && nightGain(4) === 1 && nightGain(-1) > 1, 'full by −8°, 1 above +3.5°, already lifting at sunset');
  assert.ok(exposureFactor(6, -20, undefined, 1) < exposureFactor(6, -20) * 0.51);
});

test('the shipped lights and stars decode: 24,866 lights round the lake (v1\'s layout), 9,096 stars on the unit sphere with BSC5\'s magnitudes', () => {
  const lb = new Uint8Array(readFileSync(resolve(ROOT, 'v2/assets/night/lights.bin')));
  const L = decodeLights(lb);
  assert.equal(L.count, (lb.byteLength - HEADER_BYTES) / LIGHT_BYTES);
  assert.ok(L.count > 20000 && L.count < 40000, `${L.count} lights`);
  let warm = 0, onMin = 99, onMax = -99;
  for (let i = 0; i < L.count; i++) {
    const k = i * LIGHT_FLOATS;
    assert.ok(Math.abs(L.data[k]) < 40000 && Math.abs(L.data[k + 2]) < 40000, 'within the map');
    assert.ok(L.data[k + 1] > -10 && L.data[k + 1] < 1500, `a height above the lake: ${L.data[k + 1]}`);
    assert.ok(L.data[k + 6] > 0 && L.data[k + 6] <= 6, 'a size in metres');
    onMin = Math.min(onMin, L.data[k + 7]); onMax = Math.max(onMax, L.data[k + 7]);
    if (L.data[k + 3] > L.data[k + 5]) warm++;
  }
  assert.ok(onMin >= -7 && onMax <= 3, `the switch-on elevations span v1's: ${onMin}…${onMax}`);
  assert.ok(warm / L.count > 0.7, 'most lights are warm (windows, sodium)');
  const sb = new Uint8Array(readFileSync(resolve(ROOT, 'v2/assets/night/stars.bin')));
  const S = decodeStars(sb);
  assert.equal(S.count, 9096);
  let bright = 0, mMin = 99, mMax = -99;
  for (let i = 0; i < S.count; i++) {
    const k = i * STAR_FLOATS;
    assert.ok(Math.abs(Math.hypot(S.data[k], S.data[k + 1], S.data[k + 2]) - 1) < 1e-6, 'unit');
    mMin = Math.min(mMin, S.data[k + 3]); mMax = Math.max(mMax, S.data[k + 3]);
    if (S.data[k + 3] < 1) bright++;
  }
  assert.ok(mMin < -1 && mMin > -2 && mMax > 6 && mMax < 8, `BSC5 runs −1.46 … 6.5: ${mMin.toFixed(2)} … ${mMax.toFixed(2)}`);
  assert.ok(bright > 10 && bright < 30, `${bright} stars brighter than magnitude 1 (the sky has 15)`);
});

test('the pack tool round-trips a layout through the file format (quantised to 1 m, 0.25 m, 1/255, 0.1 m, 0.5°)', () => {
  const rows = [[1234.4, 12.1, -5678.6, 1, 0.62, 0.32, 1.2, -3.5], [-30000, 1100, 30000, 0.9, 0.93, 1.0, 3.0, 2.5]];
  const lights = { count: rows.length, data: Float32Array.from(rows.flat()) };
  const bytes = packLights(lights);
  assert.equal(bytes.byteLength, HEADER_BYTES + rows.length * LIGHT_BYTES);
  const back = decodeLights(bytes);
  assert.equal(back.count, 2);
  for (let i = 0; i < 2; i++) {
    const k = i * LIGHT_FLOATS, r = rows[i];
    assert.ok(Math.abs(back.data[k] - r[0]) <= 0.5 && Math.abs(back.data[k + 2] - r[2]) <= 0.5 && Math.abs(back.data[k + 1] - r[1]) <= 0.125);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(back.data[k + 3 + c] - r[3 + c]) <= 1 / 255);
    assert.ok(Math.abs(back.data[k + 6] - r[6]) <= 0.05 && Math.abs(back.data[k + 7] - r[7]) <= 0.25);
  }
  assert.throws(() => decodeLights(new Uint8Array(32)), /VLT1/);
});

test('the nav lights: on after sunset, the green to starboard and the red to port, the sternlight astern, none of them from the wrong side', () => {
  const out = new Float32Array(3 * GLOW_FLOATS), dims = DEFAULT_DIMS.HULL;
  const pose = { x: 100, z: -50, heading: 0, heave: 0.2, pitch: 0, heel: 0 };   // heading 0: the bow toward −z (north)
  const at = (eye, sun = -10) => { navLights(out, { pose, sunElevDeg: sun, eye, dims }); return [out[7], out[15], out[23]]; };   // green, red, white
  const [g1, r1, w1] = at([100 + 30, 2, -50 - 20]);   // off the starboard bow
  assert.ok(g1 > 0.3 && r1 === 0 && w1 === 0, `starboard bow: green only (${g1}, ${r1}, ${w1})`);
  const [g2, r2, w2] = at([100 - 30, 2, -50 - 20]);   // off the port bow
  assert.ok(r2 > 0.3 && g2 === 0 && w2 === 0, 'port bow: red only');
  const [g3, r3, w3] = at([100, 2, -50 + 40]);   // dead astern
  assert.ok(w3 > 0.3 && g3 === 0 && r3 === 0, 'astern: the sternlight only');
  assert.deepEqual(at([130, 2, -70], 20), [0, 0, 0], 'off by day');
  // the lenses ride the hull: the bow light stands forward of the stern light along the heading, and above the waterline
  navLights(out, { pose, sunElevDeg: -10, eye: [0, 2, 0], dims });
  assert.ok(out[2] < out[2 + 2 * GLOW_FLOATS], 'the bow light is north (−z) of the stern light at heading 0');
  assert.ok(out[1] > 1.5 && out[1] < 2.2, `the bow light ≈ 1.9 m up: ${out[1]}`);
  const turned = { ...pose, heading: Math.PI / 2 };   // the bow toward +x (east)
  navLights(out, { pose: turned, sunElevDeg: -10, eye: [0, 2, 0], dims });
  assert.ok(out[0] > out[0 + 2 * GLOW_FLOATS], 'turned east: the bow light is east of the stern light');
});

test('the render module on a fake device: the record, the caps, the glow modes, no pipeline after attach', () => {
  const made = { textures: 0, buffers: 0, pipelines: [], writes: 0 };
  const device = {
    createTexture: () => { made.textures++; return { createView: () => ({}) }; },
    createSampler: () => ({}),
    createBuffer: ({ size }) => { made.buffers++; return { size }; },
    createBindGroupLayout: () => ({}), createBindGroup: () => ({}), createPipelineLayout: () => ({}),
    queue: { writeBuffer: () => { made.writes++; }, copyExternalImageToTexture: () => {} },
  };
  const reg = { shader: (n, code) => { assert.ok(code.includes('@vertex') && code.includes('@fragment'), n); return {}; }, add: (n) => made.pipelines.push(n) };
  const night = createNight({ device, reg, frameBGL: {}, frameBG: {}, U: {}, frameStruct: 'struct Frame { a: vec4f }', hdrTarget: { format: 'rgba16float' } });
  night.attach({ skyBGL: {}, skyBG: {} });
  assert.deepEqual(made.pipelines, ['night-stars', 'night-glows']);
  assert.equal(made.textures, 2, 'the two maps, at their full size, before any load');
  const wb = night.waterBind(4);
  assert.deepEqual(wb.layout.map((e) => e.binding), [4, 5, 6, 7]); assert.equal(wb.entries.length, 4);
  const w0 = made.writes;
  night.update({ hour: 22.5, levels: { air: 1, domes: 1, band: 1, k: 1 }, t: 3, eye: [0, 2, 0], sunElevDeg: -18, focalPx: 900 });
  assert.ok(made.writes > w0, 'the record is written');
  assert.equal(night.stats.band, 0, 'no band before the maps are in');
  assert.ok(CAPS.stars >= 9096 && CAPS.lights >= 24866, 'the buffers hold the shipped sets');
  assert.ok(GLOW.minPx >= 2 && GLOW.townRadiance > 0);
});

//, 2026-11-17: "the night stars + town lights data only when the sun is low"; every device)
test('the night\'s data is due only with the sun below loadBelowDeg (a day page never fetches it), and before the airglow and the stars come in', () => {
  for (const e of [60, 30, 8.01, 8]) assert.equal(nightLoadDue(e), false, `${e}°: not yet`);
  for (const e of [7.99, 2, 0, -5, -30]) assert.equal(nightLoadDue(e), true, `${e}°: due`);
  assert.equal(nightLoadDue(NaN), false);
  // nothing shows yet at the line: the airglow, the band and the lights all read 0 by day
  const L = nightLevels({ sunElevDeg: NIGHT.loadBelowDeg });
  for (const [k, v] of Object.entries(L)) if (typeof v === 'number' && k !== 'k') assert.ok(v < 1e-6, `${k} ${v} at ${NIGHT.loadBelowDeg}°`);
  const Lt = decodeLights(new Uint8Array(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets/night/lights.bin'))));
  let first = -90; for (let k = 0; k < Lt.count; k++) first = Math.max(first, Lt.data[k * 8 + 7]);
  assert.ok(first < NIGHT.loadBelowDeg - 4, `the first town light comes on at ${first}°, well under the line`);
});

test('the clear night (owner 2026-11-18): Clear and Fair thin to no cloud from the sunset to −5° and back by the sunrise; the show clears; a storm, Cloudy and ?cloudcov keep theirs', async () => {
  const { nightCover, nightClearK, NIGHT_CLEAR } = await import('../sim/night.js');
  const { cloudDensity } = await import('../sim/clouds.js');
  assert.equal(nightCover({ cover: 0.6, sunElevDeg: 20 }), 0.6, 'the day keeps its deck');
  assert.equal(nightCover({ cover: 0.6, sunElevDeg: 0 }), 0.6, 'the sunset still has it');
  const mid = nightCover({ cover: 0.6, sunElevDeg: -2.5 });
  assert.ok(mid < 0.6 && mid > NIGHT_CLEAR.cover, `half way at −2.5° (${mid})`);
  assert.equal(nightCover({ cover: 0.6, sunElevDeg: -5 }), NIGHT_CLEAR.cover);
  assert.equal(nightCover({ cover: 0.12, sky: 'clear', sunElevDeg: -15 }), NIGHT_CLEAR.cover, 'Clear too');
  for (let e = 1; e > -6; e -= 0.25) assert.ok(nightClearK(e - 0.25) >= nightClearK(e), 'no step back while the sun sets');
  // no cloud anywhere at the clear night's coverage: the densest sample of the weather map's swing is empty
  assert.equal(cloudDensity({ shape: 1, detail: 0, wR: 1, wG: 0.5, h: 0.3, coverage: NIGHT_CLEAR.cover, type: 0.35 }), 0);
  assert.equal(nightCover({ cover: 0.6, sunElevDeg: 30, show: true }), NIGHT_CLEAR.cover, 'the show\'s sky is clear (a pinned show by day too)');
  assert.equal(nightCover({ cover: 0.6, sunElevDeg: -15, storm: true, show: true }), 0.6, 'a storm keeps its deck, in the show too');
  assert.equal(nightCover({ cover: 0.6, sunElevDeg: -15, sky: 'storm' }), 0.6);
  assert.equal(nightCover({ cover: 0.85, sunElevDeg: -15, sky: 'cloudy' }), 0.85, 'Cruise\'s Cloudy keeps its deck');
  assert.equal(nightCover({ cover: 0.6, sunElevDeg: -15, explicit: true }), 0.6, 'a URL\'s ?cloudcov keeps its deck');
});
