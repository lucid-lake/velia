// The adaptive mixer's contract (src/audio.js). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixAt, BedScheduler, worldState, createAudio, LEVEL, LAKE_LP } from '../src/audio.js';
import { WindField } from '../src/sim/wind.js';
import { makeTerrain } from '../src/sim/terrain.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} ± ${tol}`);

test('wind: light below 4 m/s, strong above 9 m/s, an equal-power crossfade between', () => {
  const at = (s) => mixAt({ windSpeed: s }).gains;
  assert.equal(at(0).wind_light, 0);
  assert.equal(at(0).wind_strong, 0);
  near(at(3).wind_light, LEVEL.wind_light, 1e-9, 'light at 3 m/s');
  assert.equal(at(3).wind_strong, 0);
  near(at(10).wind_light, 0, 1e-9, 'light at 10 m/s');
  assert.ok(at(10).wind_strong > 0.7 * LEVEL.wind_strong);
  // the beds never dip as the wind rises (they did by ≈5 dB from 4 to 8 m/s when the strong loop started at 0.7)
  let lastBed = 0;
  for (let s = 0.5; s <= 14; s += 0.5) { const g = at(s), p = Math.hypot(g.wind_light, g.wind_strong); assert.ok(p >= lastBed - 0.02, `bed level dips at ${s} m/s`); lastBed = p; }
  for (const s of [4.5, 5.5, 6.5, 7.5, 8.5]) {   // inside the crossfade the summed power holds
    const g = at(s);
    near((g.wind_light / LEVEL.wind_light) ** 2 + (g.wind_strong / LEVEL.wind_strong) ** 2, 1, 1e-9, `power at ${s} m/s`);
  }
  let prev = -1;
  for (let s = 0; s <= 14; s += 0.5) { const v = at(s).wind_strong; assert.ok(v >= prev - 1e-12, `strong falls at ${s}`); prev = v; }
});

test('lapping: loudest and brightest on the shore, falling and duller with distance, on either side', () => {
  const g = (d) => mixAt({ shoreDist: d, windSpeed: 4 });
  near(g(0).lakeLowpassHz, LAKE_LP.nearHz, 1e-6, 'low-pass on the shore');
  near(g(LAKE_LP.farM).lakeLowpassHz, LAKE_LP.farHz, 1e-6, 'low-pass far out');
  let pg = Infinity, pf = Infinity;
  for (const d of [0, 15, 30, 60, 120, 250, 600, 1200]) {
    const m = g(d);
    assert.ok(m.gains.lake_lap <= pg + 1e-12 && m.lakeLowpassHz <= pf + 1e-9, `not falling at ${d} m`);
    pg = m.gains.lake_lap; pf = m.lakeLowpassHz;
  }
  assert.ok(g(600).gains.lake_lap < 0.15 * g(0).gains.lake_lap, '600 m out is under 15 % of the shore');
  near(g(-200).gains.lake_lap, g(200).gains.lake_lap, 1e-12, 'on the lake as on the land');
  assert.ok(mixAt({ shoreDist: 0, windSpeed: 8 }).gains.lake_lap > mixAt({ shoreDist: 0, windSpeed: 0 }).gains.lake_lap, 'wind raises the lapping');
});

test('birds: only 05:54–08:30 PDT', () => {
  const b = (h) => mixAt({ hour: h }).gains.birds_dawn;
  for (const h of [0, 3, 5.8, 8.6, 10, 12, 18, 23.9]) assert.equal(b(h), 0, `birds at ${h} h`);
  for (const h of [6.4, 7, 8]) near(b(h), LEVEL.birds_dawn, 1e-9, `birds at ${h} h`);
  assert.ok(b(6.15) > 0 && b(6.15) < LEVEL.birds_dawn, 'fading in at 06:09');
  assert.ok(mixAt({ hour: 7, rain: 1 }).gains.birds_dawn < 0.5 * b(7), 'rain quiets them');
});

test('rain by the weather uniform; loons at night on calm water', () => {
  assert.equal(mixAt({ rain: 0 }).gains.rain_water, 0);
  near(mixAt({ rain: 1 }).gains.rain_water, LEVEL.rain_water, 1e-12, 'full rain');
  assert.ok(mixAt({ rain: 0.25 }).gains.rain_water < mixAt({ rain: 0.5 }).gains.rain_water);
  assert.equal(mixAt({ hour: 12 }).gains.loon, 0);
  near(mixAt({ hour: 2 }).gains.loon, LEVEL.loon, 1e-12, 'loons at 02:00');
  assert.equal(mixAt({ hour: 2, windSpeed: 12 }).gains.loon, 0, 'strong wind hides them');
});

test('gains are pure: the same state gives the same mix', () => {
  const s = { hour: 5.9, windSpeed: 6.3, shoreDist: 140, rain: 0.2 };
  assert.deepEqual(mixAt(s), mixAt({ ...s }));
});

test('world state: wind at the camera from the wind field, shore distance from the terrain; driven by t', () => {
  const terrain = makeTerrain({ seed: 1 });
  const wind = new WindField({ seed: 1 });
  wind.setTerrain(terrain.heightAt);
  const camB = { position: { x: 0, y: 1.6, z: 1500 } };
  const a = worldState({ t: 30, hour: 5.2, camera: camB, wind, terrain });
  near(a.windSpeed, wind.sample(0, 1500, 30).speed, 1e-12, 'wind at cam B');
  near(a.shoreDist, terrain.shoreDistance(0, 1500), 1e-12, 'shore at cam B');
  assert.deepEqual(worldState({ t: 30, hour: 5.2, camera: camB, wind, terrain }), a, 'same t, same state');
  // over 10 min at cam B the wind gains follow the gusts, and stay deterministic
  const run = () => { const out = []; for (let t = 0; t <= 600; t += 5) out.push(mixAt(worldState({ t, hour: 5.2, camera: camB, wind, terrain })).gains); return out; };
  const r1 = run(), r2 = run();
  assert.deepEqual(r1, r2);
  const light = r1.map((g) => g.wind_light);
  assert.ok(Math.max(...light) - Math.min(...light) > 0.01, 'the gusts move the wind layer');
});

test('beds: silence first, long gaps, the world picks the bed', () => {
  const s = new BedScheduler({ seed: 3 });
  const cues = [];
  for (let t = 0; t <= 3600; t += 1) cues.push(...s.update(t, { hour: 6.3 + t / 3600, windSpeed: t > 2400 ? 9 : 3 }));
  assert.ok(cues.length >= 2, `${cues.length} cues in an hour`);
  assert.equal(cues[0].t, s.firstS, 'the first bed waits for firstS');
  for (let i = 1; i < cues.length; i++) {
    const gap = cues[i].t - cues[i - 1].end;
    assert.ok(gap >= s.gapS[0], `gap ${gap} s`);
    const prev = cues.slice(0, i).findLast((c) => c.bed === cues[i].bed);
    assert.ok(!prev || cues[i].t - prev.t >= s.repeatS, `${cues[i].bed} repeats after ${cues[i].t - prev?.t} s`);
  }
  const music = cues.reduce((a, c) => a + Math.min(3600, c.end) - c.t, 0) / 3600;
  assert.ok(music <= 0.25, `music ${(music * 100).toFixed(0)} % of the hour`);
  assert.ok(cues.filter((c) => c.t < 2400).every((c) => c.bed === 'dawn'), 'calm hours: dawn');
  assert.ok(cues.filter((c) => c.t > 2400).every((c) => c.bed === 'wind'), 'past 7 m/s: wind');
  assert.ok(!cues.some((c) => c.bed === 'vista'), 'no vista without an event');
  // midday, light wind: silence
  const m = new BedScheduler({ seed: 3 });
  for (let t = 0; t <= 3600; t += 1) assert.deepEqual(m.update(t, { hour: 13, windSpeed: 3 }), []);
});

test('beds: the vista swell plays once per place, never over a bed, never before firstS', () => {
  const s = new BedScheduler({ seed: 1 });
  assert.equal(s.vista(10, 'ridge'), null, 'too early');
  const v = s.vista(100, 'ridge');
  assert.equal(v.bed, 'vista');
  assert.equal(s.vista(700, 'ridge'), null, 'a second swell at the same place');
  assert.equal(s.vista(150, 'bay'), null, 'over the playing swell');
  assert.equal(s.vista(v.end + 5, 'bay'), null, 'inside the quiet after it');
  assert.equal(s.vista(v.end + s.vistaQuietS, 'bay').place, 'bay');
});

test('beds: the same update times give the same cues', () => {
  const go = () => { const s = new BedScheduler({ seed: 9 }); const c = []; for (let t = 0; t < 7200; t += 2) c.push(...s.update(t, { hour: 6.3, windSpeed: 2 })); c.push(s.vista(7300, 'x')); return c; };
  assert.deepEqual(go(), go());
});

test('the engine is muted until start(): no audio context before a gesture', () => {
  let made = 0;
  class FakeCtx { constructor() { made++; } }
  const a = createAudio({ Ctx: FakeCtx, fetchFn: () => { throw new Error('no fetch before start'); } });
  for (let t = 0; t <= 200; t += 1) a.update(t, { hour: 7, windSpeed: 3, shoreDist: 20 });
  assert.equal(made, 0);
  const st = a.stats();
  assert.equal(st.muted, true);
  assert.equal(st.started, false);
  assert.equal(st.cues[0].bed, 'dawn', 'the scheduler still runs while muted');
  near(st.gains.birds_dawn, LEVEL.birds_dawn, 1e-12, 'and the mix');
});
