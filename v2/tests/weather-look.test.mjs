// The storm and weather look (owner, 2026-11-24): one wind drives the rain's lean, the deck's drift and the gulls' getter
// (v2/sim/weatherWind.js); a look per weather with eased transitions (v2/sim/weatherLook.js); rain on the lens, off under
// Reduced Motion and in the helm view. Behaviour only: the modules are called and their outputs read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherWind, rainDrift, aloftWind, towardOf, WEATHER_WIND } from '../sim/weatherWind.js';
import { WEATHER_LOOKS, LOOK_ROWS, IDENTITY, lookWeights, blendLook, gradeColour, createWeatherLook, createLensWater, fillLookRecord, isIdentity, WLOOK_FLOATS } from '../sim/weatherLook.js';
import { TONEMAP, TONEMAP_MODES } from '../render/shaders.js';

// a wind field that blows from a bearing at a speed, with a gust bump in time
const fieldOf = (fromDeg, speed, gustAt = () => 1) => ({
  sample(x, z, t) { const [ux, uz] = towardOf(fromDeg), s = speed * gustAt(t); return { vx: ux * s, vz: uz * s, speed: s, dirDeg: fromDeg }; },
});

test('the rain leans downwind: its drift points where the wind blows, and a gust leans it more than its speed alone', () => {
  for (const from of [0, 90, 200, 250, 315]) {
    const ww = createWeatherWind({ field: fieldOf(from, 8) });
    ww.update({ eye: [0, 2, 0], t: 10 });
    const [ux, uz] = towardOf(from);
    const n = Math.hypot(ww.rain.vx, ww.rain.vz);
    assert.ok(Math.abs(ww.rain.vx / n - ux) < 1e-9 && Math.abs(ww.rain.vz / n - uz) < 1e-9, `from ${from}: the drift is downwind`);
    assert.ok(Math.abs(n - 8) < 1e-9, 'a steady wind: the drift is the wind');
  }
  // a gust: 8 m/s steady for 20 s, then 11 m/s; the rain's drift grows by more than 11 / 8
  let g = 1;
  const ww = createWeatherWind({ field: fieldOf(250, 8, () => g) });
  for (let i = 0; i <= 1200; i++) ww.update({ eye: [0, 2, 0], t: i / 60 });
  const calm = ww.rain.lean;
  g = 11 / 8;
  ww.update({ eye: [0, 2, 0], t: 1201 / 60 });
  assert.ok(ww.eye.gust > 1.3, `the gust over the mean: ${ww.eye.gust}`);
  assert.ok(Math.hypot(ww.rain.vx, ww.rain.vz) > 11 * 1.4, `the drift leans past the wind's own rise: ${Math.hypot(ww.rain.vx, ww.rain.vz)}`);
  assert.ok(ww.rain.lean > calm + 0.15, `the lean grows: ${calm} → ${ww.rain.lean} rad`);
  // the same gust held: the mean catches up and the extra lean goes
  for (let i = 1202; i < 1202 + 60 * 60; i++) ww.update({ eye: [0, 2, 0], t: i / 60 });
  assert.ok(ww.eye.gust < 1.01 && Math.abs(Math.hypot(ww.rain.vx, ww.rain.vz) - 11) < 0.2, 'a held wind is no gust');
  assert.equal(rainDrift(3, 4, 1).k, 1); assert.ok(rainDrift(3, 4, 3).k <= 1 + WEATHER_WIND.gustCap);
});

test('the clouds drift with the one wind: integrated on the scene clock, placed at speed × t after a cut, the storm steering them', () => {
  const ww = createWeatherWind({ field: fieldOf(200, 6) });
  const base = { speedMs: 5, dirDeg: 200 };
  ww.update({ eye: [0, 2, 0], t: 100, base, cut: 0 });
  const [ux, uz] = towardOf(200);
  assert.ok(Math.abs(ww.drift[0] - ux * 5 * 1.5 * 100) < 1e-6 && Math.abs(ww.drift[1] - uz * 5 * 1.5 * 100) < 1e-6, 'the first frame: speed × t (the old drift)');
  for (let i = 1; i <= 600; i++) ww.update({ eye: [0, 2, 0], t: 100 + i / 60, base, cut: 0 });
  assert.ok(Math.abs(ww.drift[0] - ux * 5 * 1.5 * 110) < 1e-6, 'a steady wind integrates to speed × t');
  // a change of speed moves the deck at the new speed from now on, never jumps it by Δspeed × t
  const before = [...ww.drift];
  ww.update({ eye: [0, 2, 0], t: 110 + 1 / 60, base: { speedMs: 9, dirDeg: 200 }, cut: 0 });
  assert.ok(Math.hypot(ww.drift[0] - before[0], ww.drift[1] - before[1]) < 9 * 1.5 / 60 + 1e-9, 'no jump on a change of wind');
  // a storm's front: the wind aloft turns to the steering flow (the day's 200 deg veered: from 250 deg)
  const a = aloftWind(5, 200, 1);
  assert.ok(Math.abs(a.fromDeg - (200 + WEATHER_WIND.steerVeerDeg)) < 1e-6 && Math.abs(a.speedMs - WEATHER_WIND.steerMs) < 1e-9);
  ww.update({ eye: [0, 2, 0], t: 111, base, storm: { on: 1, front: 1 }, cut: 0 });
  assert.ok(Math.abs(ww.aloft.fromDeg - 250) < 1e-6, 'under the storm the deck rides its cells\' flow');
  // a time cut re-places the deck where the old drift put it: the same frame whatever came before (determinism under ?hour)
  const w2 = createWeatherWind({ field: fieldOf(200, 6) });
  w2.update({ eye: [0, 2, 0], t: 400, base, cut: 3 });
  ww.update({ eye: [0, 2, 0], t: 400, base, cut: 3 });
  assert.deepEqual(ww.drift, w2.drift);
});

test('the gulls\' getter: the one wind at a point, the same numbers the field gives', () => {
  const ww = createWeatherWind({ field: fieldOf(250, 7) });
  ww.update({ eye: [0, 2, 0], t: 5 });
  const o = ww.at(100, -40);
  assert.equal(o.speedMs, 7); assert.equal(o.fromDeg, 250);
  assert.equal(ww.eye.fromDeg, 250); assert.equal(ww.eye.speedMs, 7);
});

test('the preset table: every row whole; Fair the identity; the storm moody and contrasty, not flat grey', () => {
  for (const k of LOOK_ROWS) {
    const L = WEATHER_LOOKS[k];
    for (const f of ['exposure', 'contrast', 'saturation', 'rim', 'grad', 'vignette', 'haze']) assert.ok(Number.isFinite(L[f]), `${k}.${f}`);
    for (const f of ['tint', 'shadows', 'highlights']) assert.equal(L[f].length, 3, `${k}.${f}`);
  }
  assert.ok(isIdentity(WEATHER_LOOKS.fair));
  for (const k of ['clear', 'overcast', 'storm', 'rain', 'clearing']) assert.ok(!isIdentity(WEATHER_LOOKS[k]), `${k} has its own look`);
  const grey = [0.18, 0.18, 0.18], dark = [0.03, 0.035, 0.04], bright = [1.2, 1.15, 1.1];
  // Fair: no pixel moves
  for (const c of [grey, dark, bright]) gradeColour(c, WEATHER_LOOKS.fair).forEach((x, i) => assert.ok(Math.abs(x - c[i]) < 1e-9));
  // the storm: the shadows darker and cooler (blue over red), the highlights brighter, the water under the horizon darker
  const S = WEATHER_LOOKS.storm;
  const d = gradeColour(dark, S), b = gradeColour(bright, S, { sunCos: 0.9 });
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(d) < lum(dark) * 0.8, `the storm's shadows go down: ${lum(dark)} → ${lum(d)}`);
  assert.ok(d[2] / d[0] > dark[2] / dark[0] * 1.15, 'cooler shadows');
  assert.ok(lum(b) / lum(d) > (lum(bright) / lum(dark)) * 1.5, 'more contrast between the lit and the dark');
  const hot = [4, 3.9, 3.8], rimOn = gradeColour(hot, S, { sunCos: 0.95 }), rimOff = gradeColour(hot, { ...S, rim: 0 }, { sunCos: 0.95 });
  assert.ok(lum(rimOn) > lum(rimOff) * 1.2 && rimOn[0] / rimOn[2] > rimOff[0] / rimOff[2], 'a warm lit rim toward the sun on the brightest');
  const high = gradeColour(grey, S, { dirY: 0.5 }), band = gradeColour(grey, S, { dirY: 0.03 }), water = gradeColour(grey, S, { dirY: -0.2 });
  assert.ok(lum(band) > lum(water) * 1.25 && lum(band) > lum(high) * 1.5, 'the grad: a bright band at the horizon over dark water, under a heavy sky');
  assert.ok(S.saturation > 0.8, 'colour kept (the old steel took 70 % of it)');
  // the clearing warm, the overcast cool
  const cl = gradeColour(grey, WEATHER_LOOKS.clearing), oc = gradeColour(grey, WEATHER_LOOKS.overcast);
  assert.ok(cl[0] > cl[2] * 1.1 && oc[2] > oc[0]);
});

test('the weights: one row per weather, summing to 1, and continuous as the weather changes', () => {
  const sum = (w) => LOOK_ROWS.reduce((a, k) => a + w[k], 0);
  assert.equal(lookWeights({ cover: 0.12 }).clear, 1);
  assert.equal(lookWeights({ cover: 0.28 }).fair, 1);
  assert.equal(lookWeights({ cover: 0.85 }).overcast, 1);
  assert.equal(lookWeights({ cover: 0.6 }).fair, 1, 'v1\'s deck (the frames matched to v1) stays Fair');
  assert.equal(lookWeights({ cover: 0.28, on: 1, dark: 1, rain: 0 }).storm, 1);
  assert.equal(lookWeights({ cover: 0.28, on: 1, dark: 1, rain: 1 }).rain, 1);
  assert.equal(lookWeights({ cover: 0.28, on: 1, dark: 0.2, gold: 1 }).clearing, 1);
  assert.equal(lookWeights({ cover: 0.28, on: 0, dark: 1, rain: 1 }).fair, 1, 'no storm, no storm look');
  // a whole storm arc's envelopes sampled finely: the weights always sum to 1 and never step
  let prev = null;
  for (let i = 0; i <= 1000; i++) {
    const s = i / 1000;
    const w = lookWeights({ cover: 0.28 + 0.57 * s, on: 1, dark: Math.sin(Math.PI * s), rain: Math.max(0, Math.sin(Math.PI * (s * 1.4 - 0.2))), gold: Math.max(0, s - 0.7) / 0.3 });
    assert.ok(Math.abs(sum(w) - 1) < 1e-9, `sum at ${s}`);
    if (prev) for (const k of LOOK_ROWS) assert.ok(Math.abs(w[k] - prev[k]) < 0.02, `${k} steps at ${s}`);
    prev = { ...w };
  }
  const half = blendLook({ fair: 0.5, storm: 0.5 });
  assert.ok(Math.abs(half.contrast - (1 + WEATHER_LOOKS.storm.contrast) / 2) < 1e-12);
});

test('the transitions blend over time on the scene clock, snap on a cut, and repeat exactly (determinism under ?hour)', () => {
  const run = () => {
    const L = createWeatherLook();
    const out = [];
    L.update({ cover: 0.28, t: 0, cut: 0 });
    for (let i = 1; i <= 600; i++) { const x = L.update({ cover: 0.28, on: 1, dark: 1, rain: 0, t: i / 60, cut: 0 }); out.push(x.contrast); }
    return out;
  };
  const a = run(), b = run();
  assert.deepEqual(a, b, 'the same frames each run');
  assert.ok(a[0] > 1 && a[0] < 1.05, `the first frame of a storm only starts to move: ${a[0]}`);
  for (let i = 1; i < a.length; i++) assert.ok(a[i] >= a[i - 1], 'it eases monotonically');
  assert.ok(Math.abs(a.at(-1) - WEATHER_LOOKS.storm.contrast) < 0.04, `10 s later it is the storm's: ${a.at(-1)}`);
  const L = createWeatherLook();
  L.update({ cover: 0.28, t: 0, cut: 0 });
  const x = L.update({ cover: 0.28, on: 1, dark: 1, t: 50, cut: 1 });   // a time cut (a ?hour pick): straight to the target
  assert.equal(x.contrast, WEATHER_LOOKS.storm.contrast);
  const f = createWeatherLook({ force: 'clearing' }).update({ cover: 0.28, t: 0 });
  assert.equal(f.saturation, WEATHER_LOOKS.clearing.saturation, '?wlook= pins a row');
  assert.ok(isIdentity(createWeatherLook({ force: 'off' }).update({ cover: 0.12, on: 1, dark: 1, t: 0 })), '?wlook=off: the identity');
});

test('the composite\'s record: the grade off at the identity (Fair keeps its pixels), on otherwise; the lens\'s numbers', () => {
  const r = new Float32Array(WLOOK_FLOATS);
  fillLookRecord(r, IDENTITY);
  assert.equal(r[11], 0, 'Fair: the composite skips the grade');
  fillLookRecord(r, WEATHER_LOOKS.storm, { shade: 0.4, lens: { amount: 0.3, gx: 0.2, gy: 0.98, wet: 1 }, t: 3700 });
  assert.equal(r[11], 1); assert.ok(Math.abs(r[8] - WEATHER_LOOKS.storm.contrast) < 1e-6); assert.ok(Math.abs(r[21] - 0.4) < 1e-6);
  assert.ok(Math.abs(r[24] - 0.3) < 1e-6 && Math.abs(r[28] - 100) < 1e-3, 'the lens amount and its wrapped clock');
  // every composite variant carries the grade; only the storm ones carry the lens
  for (const m of TONEMAP_MODES) {
    const w = TONEMAP(4, m);
    assert.ok(w.includes('fn weatherGrade('), `${m}: the grade`);
    assert.equal(w.includes('fn lensRain('), m !== 'plain', `${m}: the lens only with a storm`);
  }
});

test('rain on the lens: wets in rain and dries slowly, wetter facing into the air, runs downwind across the screen, none when off (Reduced Motion, the helm view)', () => {
  const lens = createLensWater();
  const into = { air: { x: 0, z: 10 }, fwd: [0, 0, -1], right: [1, 0, 0] };   // the air blowing toward +z, the lens looking at −z: into it
  let s = lens.update({ rain: 1, on: true, ...into, t: 0 });
  assert.ok(s.amount > 0.42 * 0.9, `a storm's first frame: wet at once (a capture): ${s.amount}`);
  const facingInto = s.amount;
  const lee = createLensWater().update({ rain: 1, on: true, air: { x: 0, z: 10 }, fwd: [0, 0, 1], right: [-1, 0, 0], t: 0 });
  assert.ok(lee.amount < facingInto * 0.5, `looking downwind the lens stays drier: ${lee.amount} vs ${facingInto}`);
  // the rain stops: it dries over seconds, not at once
  for (let i = 1; i <= 60; i++) s = lens.update({ rain: 0, on: true, ...into, t: i / 60 });
  assert.ok(s.wet > 0.8, `1 s after: still wet (${s.wet})`);
  for (let i = 61; i <= 60 * 30; i++) s = lens.update({ rain: 0, on: true, ...into, t: i / 60 });
  assert.ok(s.wet < 0.05, `30 s after: dry (${s.wet})`);
  // a cross wind runs the drops sideways on the screen (downwind)
  const side = createLensWater().update({ rain: 1, on: true, air: { x: 8, z: 0 }, fwd: [0, 0, -1], right: [1, 0, 0], t: 0 });
  assert.ok(side.gx > 0.3 && side.gy > 0.5, `the air to the right: the drops run right and down (${side.gx}, ${side.gy})`);
  // off: Reduced Motion or the helm view or the policy
  const off = createLensWater().update({ rain: 1, on: false, ...into, t: 0 });
  assert.equal(off.amount, 0);
});
