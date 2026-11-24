// wow/storm: the Tahoe afternoon thunderstorm's arc, its thunder, its rainbow and its outflow on the wind field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARC, phaseAt, arcAt, cellAt, arcTime, sceneTimeOf, strikesBetween, flashOf, thunderDelayS, thunderOf, SOUND_MS,
  rainbowTopDeg, rainbowPossible, rainbowWeight, rainbowEnv, DIR, CELL, HERO } from '../src/sim/weather/stormArc.js';

test('the hero strikes: four bolts on the western ridges, back along the drift from the reference', () => {
  const R = [1200, -1050], all = strikesBetween(1, 0, 300, R);
  assert.equal(HERO.length, 4);
  for (const [s] of HERO) {
    const k = all.find((x) => Math.abs(x.s - s) < 0.5);
    assert.ok(k && k.bolt, `hero at ${s}`);
    const back = -((k.x - R[0]) * DIR[0] + (k.z - R[1]) * DIR[1]);
    assert.ok(back > 2000, `${s}: ${back} m behind the reference`);
  }
});
import { stormWindAt, applyStorm, frontAlong } from '../src/sim/weather/stormWind.js';
import { thunderSamples } from '../src/weather/stormAudio.js';
import { naturalPlan, stormFromParams } from '../classic/src/weather/storm.js';
import { dropsFor, RAIN_DROPS } from '../classic/src/weather/rain.js';
import { boltPaths } from '../classic/src/weather/lightning.js';
import { WindField } from '../src/sim/wind.js';
import { windState, applyWindState } from '../src/sim/wind-texture.js';
import { parseFlags } from '../src/sim/core/flags.js';

const REF = [1200, -1050];

test('the arc: four phases in order, ≈ 5 min, then done', () => {
  assert.deepEqual([-1, 0, 45, 89.9, 90, 119, 120, 209, 210, 269, 270, 299, 300].map(phaseAt),
    ['before', 'build', 'build', 'build', 'front', 'front', 'storm', 'storm', 'clear', 'clear', 'after', 'after', 'done']);
  assert.equal(ARC.build[1] - ARC.build[0], 90); assert.equal(ARC.front[1] - ARC.front[0], 30);
  assert.equal(ARC.storm[1] - ARC.storm[0], 90); assert.equal(ARC.clear[1] - ARC.clear[0], 60);
  assert.ok(ARC.end >= 270 && ARC.end <= 330);
});

test('the arc: dry while it builds, rain at the peak, gone in the clearing; gold only at the end', () => {
  const at = (s) => arcAt(s, REF, REF);
  assert.equal(at(30).rain, 0);
  assert.equal(at(20).dark, 0);
  assert.ok(at(80).dark > 0.1 && at(90).dark > 0.4 && at(90).dark < at(150).dark, 'the light flattens as it nears');
  assert.ok(at(150).rain > 0.95, `rain at the peak ${at(150).rain}`);
  assert.ok(at(150).dark > 0.9);
  assert.ok(at(260).rain < 0.05, `rain in the clearing ${at(260).rain}`);
  assert.equal(at(150).gold, 0);
  assert.ok(at(250).gold > 0.6);
  assert.ok(at(150).haze > at(60).haze);
});

test('the cell: builds west over the ridge, passes overhead, leaves east; local (the far lake stays clear)', () => {
  const a = cellAt(0, REF), b = cellAt(165, REF), c = cellAt(280, REF);
  assert.ok(a.x < REF[0] - 8000, 'starts west');
  assert.ok(Math.hypot(b.x - REF[0], b.z - REF[1]) < 1, 'overhead at 165 s');
  assert.ok(c.x > REF[0] + 6000, 'gone east');
  // 15 km up the lake from the reference, at the peak: no rain, little darkness
  const far = arcAt(150, REF, [REF[0] + 15000, REF[1] - 6000]);
  assert.equal(far.rain, 0); assert.ok(far.dark < 0.05, `far dark ${far.dark}`);
});

test('arcTime: the scene clock to the arc, compressed for films, and back', () => {
  const st = { s0: 30, t0: 100, rate: 5 };
  assert.equal(arcTime(st, 100), 30); assert.equal(arcTime(st, 110), 80);
  assert.equal(sceneTimeOf(st, 80), 110);
});

test('lightning: deterministic, none before 35 s, most in the storm, the scripted close one at 128 s', () => {
  const a = strikesBetween(1, 0, 300, REF), b = strikesBetween(1, 0, 300, REF);
  assert.deepEqual(a, b);
  assert.ok(a.every((k) => k.s >= 35 && k.s < 250));
  const n = (s0, s1) => a.filter((k) => k.s >= s0 && k.s < s1).length;
  assert.ok(n(120, 210) / 90 > n(36, 90) / 54, 'more strikes in the storm than while it builds');
  assert.ok(n(120, 210) >= 10, `storm strikes ${n(120, 210)}`);
  const close = a.find((k) => k.s >= 128 && k.s < 128.5);
  assert.ok(close && close.bolt, 'the scripted strike');
  assert.ok(Math.hypot(close.x - REF[0], close.z - REF[1]) > 1500, 'on the ridge, not on the boat');
  // split windows give the same strikes as one
  const parts = [...strikesBetween(1, 0, 150, REF), ...strikesBetween(1, 150, 300, REF)];
  assert.deepEqual(parts.map((k) => k.s), a.map((k) => k.s));
  assert.notDeepEqual(strikesBetween(2, 0, 300, REF).map((k) => k.s), a.map((k) => k.s), 'the seed changes them');
});

test('the flash: 0.1–0.3 s of light, restrikes, dimmer with distance, the same speed in a compressed film', () => {
  const k = { s: 100, x: REF[0] + 2000, z: REF[1], bolt: true };
  assert.equal(flashOf(k, 99.99, REF), 0);
  assert.ok(flashOf(k, 100.001, REF) > 0.5);
  assert.ok(flashOf(k, 100.08, REF) > flashOf(k, 100.06, REF), 'a restrike');
  assert.ok(flashOf(k, 100.3, REF) < 0.05 * flashOf(k, 100.001, REF));
  assert.equal(flashOf(k, 100.5, REF), 0);
  const far = { ...k, x: REF[0] + 9000 };
  assert.ok(flashOf(far, 100.001, REF) < 0.5 * flashOf(k, 100.001, REF));
  // rate 5: the arc runs 5×, the flash still lasts the same real time
  assert.ok(Math.abs(flashOf(k, 100 + 0.05 * 5, REF, 5) - flashOf(k, 100.05, REF, 1)) < 1e-12);
});

test('thunder: delayed by distance at 343 m/s, longer rolls far away, quieter', () => {
  assert.equal(SOUND_MS, 343);
  assert.equal(thunderDelayS(343), 1);
  assert.ok(Math.abs(thunderDelayS(3430) - 10) < 1e-9);
  assert.equal(thunderDelayS(-5), 0);
  const near = thunderOf({ x: REF[0] + 1000, z: REF[1], bolt: true }, REF), far = thunderOf({ x: REF[0] + 8000, z: REF[1], bolt: true }, REF);
  assert.ok(Math.abs(near.delayS - 1000 / 343) < 0.01, `near ${near.delayS}`);
  assert.ok(far.delayS > 23 && far.delayS < 23.5);
  assert.ok(near.level > far.level);
  assert.ok(near.rollS > 1);
  // an in-cloud flash: the sound comes from the cloud base, never sooner than base / 343
  const inCloud = thunderOf({ x: REF[0], z: REF[1], bolt: false }, REF);
  assert.ok(inCloud.delayS >= CELL.baseM / SOUND_MS - 1e-9);
});

test('thunder samples: deterministic, finite, peak at the level, a crack only when near', () => {
  const a = thunderSamples({ distM: 800, rollS: 4, level: 1, seed: 9 }, 8000), b = thunderSamples({ distM: 800, rollS: 4, level: 1, seed: 9 }, 8000);
  assert.deepEqual(a, b);
  let peak = 0; for (const v of a) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
  assert.ok(Math.abs(peak - 0.7) < 1e-6);
  // the first 50 ms: a near strike cracks, a far one is still quiet (the rumble swells in)
  const e = (x, n = 400) => { let s = 0; for (let i = 0; i < Math.min(n, x.length); i++) s += x[i] * x[i]; return s; };
  const far = thunderSamples({ distM: 9000, rollS: 8, level: 1, seed: 9 }, 8000);
  assert.ok(e(a) / e(a, Infinity) > 2 * e(far) / e(far, Infinity), 'the near one front-loaded');
});

test('the rainbow: top at 42° − the sun, only with the sun under 42° and the rain opposite it', () => {
  assert.equal(rainbowTopDeg(17), 25);
  assert.equal(rainbowTopDeg(0), 42);
  assert.equal(rainbowPossible(41.9), true); assert.equal(rainbowPossible(43), false); assert.equal(rainbowPossible(-3), false);
  const DEG = Math.PI / 180, sunAt = (elev, azDeg) => ({ x: Math.cos(elev * DEG) * Math.sin(azDeg * DEG), y: Math.sin(elev * DEG), z: -Math.cos(elev * DEG) * Math.cos(azDeg * DEG) });
  const west = sunAt(20, 280);                           // an evening sun in the WNW
  assert.ok(rainbowWeight(west, [1, 0.15]) > 0.9, 'rain to the east: a bow');
  assert.equal(rainbowWeight(west, [-1, 0]), 0, 'rain toward the sun: none');
  assert.equal(rainbowWeight(sunAt(50, 280), [1, 0.15]), 0, 'a high sun: none');
  assert.equal(rainbowWeight(sunAt(-2, 280), [1, 0.15]), 0, 'after sunset: none');
  assert.ok(rainbowEnv(150) === 0 && rainbowEnv(250) > 0.9 && rainbowEnv(299) === 0, 'in the clearing only');
});

test('the outflow on the one wind field: a lull ahead, a gust line, gusty and veered behind; none with no storm', () => {
  const st = { s0: 0, t0: 0, rate: 1, ref: REF, seed: 1 };
  const along = (m) => [REF[0] + DIR[0] * m, REF[1] + DIR[1] * m];
  const s = 110, fa = frontAlong(s);
  // probe the band's middle across a few lateral offsets (the edge is ragged)
  let best = 0;
  for (let k = -400; k <= 400; k += 5) { const [x, z] = along(fa + k); best = Math.max(best, stormWindAt(st, x, z, s).gain); }
  assert.ok(best > 1.5, `the gust line ${best}`);
  const ahead = stormWindAt(st, ...along(fa + 700), s), behind = stormWindAt(st, ...along(fa - 600), s);
  assert.ok(ahead.gain < 1, `ahead ${ahead.gain}`); assert.ok(behind.gain > 1.15, `behind ${behind.gain}`);
  assert.ok(behind.w > 0.5 && ahead.w < 0.05);
  assert.deepEqual(stormWindAt(st, ...REF, 10), { gain: 1, fromDeg: 250, w: 0 }, 'before the front forms');
  // applyStorm turns a south wind toward the WSW outflow and scales it
  const [vx, vz] = applyStorm(0, -5, { gain: 2, fromDeg: 250, w: 1 });   // from 180 (blowing north), turned all the way
  assert.ok(Math.abs(Math.hypot(vx, vz) - 10) < 1e-9);
  assert.ok(Math.abs(Math.atan2(-vx, vz) * 180 / Math.PI + 110) < 1e-6, 'from 250°');
  // the field: no storm → the same numbers as before; with one → the sample and the texture agree
  const f = new WindField({ seed: 1, base: { dirDeg: 200, speedMs: 6 } });
  const a0 = f.sample(...REF, s);
  f.storm = st;
  const a1 = f.sample(...along(fa - 600), s);
  f.storm = null;
  assert.deepEqual(f.sample(...REF, s), a0);
  assert.ok(a1.speed > 6.5, `behind the line ${a1.speed}`);
  f.storm = st;
  const tex = f.toTexture(8, 400, s, ...along(fa - 600)), c = f.sample(...along(fa - 600), s);
  const i = (4 * 8 + 4) * 2;   // near the centre texel (−600 m along; within one texel)
  assert.ok(Math.abs(Math.hypot(tex[i], tex[i + 1]) - c.speed) < 2.5);
  // the worker gets the storm with the field's state
  const g = new WindField({ seed: 1 });
  applyWindState(g, windState(f, s));
  assert.deepEqual(g.storm, st);
});

test('rain drops by tier, natural storms by seed, the URL contract', () => {
  assert.ok(RAIN_DROPS.low < RAIN_DROPS.balanced && RAIN_DROPS.balanced < RAIN_DROPS.high);
  assert.equal(dropsFor('low', 1), RAIN_DROPS.low); assert.equal(dropsFor('high', 0.5), RAIN_DROPS.high / 2); assert.equal(dropsFor('high', 0), 0);
  const plans = Array.from({ length: 200 }, (_, i) => naturalPlan(i + 1));
  const some = plans.filter(Boolean).length;
  assert.ok(some > 40 && some < 110, `natural storms ${some}/200`);
  assert.deepEqual(naturalPlan(5), naturalPlan(5));
  const q = (s) => stormFromParams(parseFlags(s));
  assert.equal(q('mode=sail'), null);
  assert.deepEqual(q('weather=storm'), { s0: 0, rate: 1, ref: null });
  assert.deepEqual(q('weather=storm&stormt=150&stormrate=5&stormref=10,-20'), { s0: 150, rate: 5, ref: [10, -20] });
});

test('a bolt: from the cloud base to the ground, deterministic, with branches', () => {
  const k = { x: 100, z: 200, seed: 77 };
  const a = boltPaths(k, 350), b = boltPaths(k, 350);
  assert.deepEqual(a, b);
  const main = a[0].pts;
  assert.deepEqual(main.at(-1), [100, 350, 200]);
  assert.ok(main[0][1] > 2000);
  assert.ok(main.length > 30);
});
