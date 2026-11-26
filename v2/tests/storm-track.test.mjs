// Storm round 2: the storm cell rides the one wind (v2/sim/weatherWind.js steerFlow → v2/sim/storm.js: the cell, the outflow's
// front and direction, the strikes, the shaders' drift), deterministic under the URL rows; the spray mist (v2/sim/mist.js,
// render/mist.js) only past its onset and in the storm, along the wind; v1's track unchanged (src/sim/weather/stormArc.js DIR).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorm, cellMask, stormFromParams, STORM_TRACK, turnToward } from '../sim/storm.js';
import { steerFlow, towardOf, WEATHER_WIND } from '../sim/weatherWind.js';
import { MIST, mistWeight, mistDrift, mistLevel, mistDir, mistFlagOf } from '../sim/mist.js';
import { createFrameUniforms, wgslStruct } from '../engine/uniforms.js';
import { LEVELS } from '../engine/quality.js';
import { WATER_DRAW_WGSL } from '../render/water.js';
import { KEY_WGSL } from '../render/clouds.js';
import { STORM_FOG_WGSL } from '../render/sky.js';
import { KEY } from '../sim/clouds.js';
import { mistWgsl } from '../render/mist.js';
import { windFor } from '../sim/wind.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { DIR, CELL, cellAt, strikesBetween, fromDegOf } from '../../src/sim/weather/stormArc.js';
import { stormWindAt } from '../../src/sim/weather/stormWind.js';

const field = (dirDeg = 200) => { const w = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, base: { dirDeg, speedMs: 6 } }); w.setTerrain(() => 0); return w; };
const REF = [2300, -1400];
// a storm on the URL's rows (?weather=storm&stormt=s0&stormref=2300,-1400) under the day's wind from dirDeg, stepped to scene t
function stormAt(dirDeg, ts, { s0 = 100, steer = null } = {}) {
  let t = 0;
  const S = createStorm({ windField: field(dirDeg), seed: 1, now: () => t, eye: () => [REF[0], 2, REF[1]], sunDir: () => ({ x: -0.9, y: 0.4, z: -0.175 }), sunElev: () => 23.5 });
  const p = stormFromParams({ weather: 'storm', stormt: String(s0), stormref: REF.join(',') });
  S.begin(); S.start({ s0: p.s0, rate: p.rate, ref: p.ref, t0: 0 });
  const out = [];
  for (const tt of ts) { t = tt; S.update(18.25, steer ? { steer: steer(tt) } : {}); out.push({ t, cell: [...S.weather.cell], dir: [...S.weather.dir], front: [...S.weather.front] }); }
  return { S, out };
}
const deg = (v) => ((Math.atan2(v[0], -v[1]) * 180 / Math.PI) % 360 + 360) % 360;   // the compass bearing a drift points to

test('the steering flow is the day\'s wind veered (no bearing of its own): the highlight afternoon keeps the arc\'s track', () => {
  for (const from of [15, 120, 200, 290]) {
    const st = steerFlow(from);
    assert.ok(Math.abs(st.fromDeg - ((from + WEATHER_WIND.steerVeerDeg) % 360)) < 1e-9);
    assert.deepEqual(st.dir, towardOf(st.fromDeg));
  }
  // the golden poses' wind (18:25, the day's breeze from 199.9) → the cell drifts within a degree of v1's 70 (it still crosses the bay's mouth)
  const day = windFor({ hour: 18.25, seed: 1, level: 2 });
  const b = deg(steerFlow(day.dirDeg).dir);
  assert.ok(Math.abs(b - CELL.bearingDeg) < 1, `the afternoon's track ${b.toFixed(2)} vs the arc's ${CELL.bearingDeg}`);
});

test('the cell, its front and its outflow follow the wind: another wind, another track through the same reference point', () => {
  for (const from of [200, 290, 20]) {
    const { S, out } = stormAt(from, [0, 1 / 60, 2 / 60, 30, 60], { s0: 100 });
    const want = steerFlow(from).dir;
    assert.ok(Math.hypot(out[4].dir[0] - want[0], out[4].dir[1] - want[1]) < 1e-9, `the drift is the steering's (from ${from})`);
    // the cell moved along the steering between arc 100 s and 160 s, and stands where the arc puts it along that drift
    const d = [out[4].cell[0] - out[0].cell[0], out[4].cell[1] - out[0].cell[1]];
    assert.ok(Math.abs(deg(d) - deg(want)) < 0.01, `moved toward ${deg(d).toFixed(2)}, the steering's ${deg(want).toFixed(2)}`);
    const c = cellAt(160, REF, want);
    assert.ok(Math.abs(c.x - out[4].cell[0]) < 1e-6 && Math.abs(c.z - out[4].cell[1]) < 1e-6);
    // over the reference at the arc's 165 s whatever the wind (the bay's mouth in the golden poses)
    const o = cellAt(165, REF, want); assert.ok(Math.hypot(o.x - REF[0], o.z - REF[1]) < 1e-6);
    // the outflow blows from where the cell comes from
    assert.ok(Math.abs(fromDegOf(S.state.dir) - steerFlow(from).fromDeg) < 1e-6);
    const w = stormWindAt(S.state, REF[0] - want[0] * 300, REF[1] - want[1] * 300, 60);
    assert.ok(Math.abs(w.fromDeg - steerFlow(from).fromDeg) < 1e-6 && w.w > 0.3, 'behind the front: veered toward the steering');
    // the strikes trail the cell along its own drift (the scripted hero strikes back along it from the reference)
    const k = strikesBetween(1, 128, 129, REF, S.state.dir)[0];
    const back = -((k.x - REF[0]) * want[0] + (k.z - REF[1]) * want[1]);
    assert.ok(Math.abs(back - 2300) < 1e-6, `the first hero strike 2,300 m back along the drift: ${back.toFixed(1)}`);
    // the shaders' drift: the uniform's track row and the cell mask stretched on the trailing side of this drift
    const U = createFrameUniforms(); U.begin(); S.fillFrame(U);
    const o2 = U.layout.offsets.track;
    assert.ok(Math.abs(U.view[o2] - want[0]) < 1e-6 && Math.abs(U.view[o2 + 1] - want[1]) < 1e-6);
    const W = { ...S.weather, cell: [0, 0, 3000], cover: 1 };
    assert.ok(cellMask(-want[0] * 2500, -want[1] * 2500, W) > cellMask(want[0] * 2500, want[1] * 2500, W), 'the trailing side is stretched');
  }
  const a = stormAt(200, [0, 30]).out[1].cell, b = stormAt(290, [0, 30]).out[1].cell;
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 1500, 'two winds, two places for the cell');
});

test('a shift of the wind turns the running track slowly; a cut snaps it; v1\'s path (no drift given) keeps DIR', () => {
  const from0 = 200, from1 = 240;
  const steer = (t) => steerFlow(t < 10 ? from0 : from1);
  const ts = []; for (let i = 0; i <= 60 * 55; i++) ts.push(i / 60);
  const { out } = stormAt(from0, ts, { s0: 60, steer });
  const b0 = deg(steerFlow(from0).dir), b1 = deg(steerFlow(from1).dir);
  const at = (t) => deg(out[Math.round(t * 60)].dir);
  assert.ok(Math.abs(at(9.9) - b0) < 1e-6, 'steady before the shift');
  const frac = (at(10 + STORM_TRACK.turnS) - b0) / (b1 - b0);
  assert.ok(Math.abs(frac - (1 - Math.exp(-1))) < 0.02, `one time constant on: ${(frac * 100).toFixed(1)} % of the turn`);
  // a cut (the clock's cut count moves) puts the track on the steering at once
  let t = 0;
  const S = createStorm({ windField: field(200), seed: 1, now: () => t, eye: () => [REF[0], 2, REF[1]] });
  S.begin(); S.start({ s0: 60, ref: REF, t0: 0 }); S.update(18.25, { steer: steerFlow(200), cut: 0 });
  t = 1 / 60; S.update(18.25, { steer: steerFlow(260), cut: 1 });
  assert.ok(Math.abs(deg(S.weather.dir) - deg(steerFlow(260).dir)) < 1e-6);
  // turnToward: the short way round
  const d = towardOf(350); turnToward(d, towardOf(10), 0.5);
  assert.ok(Math.abs(deg([-d[0], -d[1]]) - 0) < 1e-6 || Math.abs(deg([-d[0], -d[1]]) - 360) < 1e-6);
  // v1: a state with no drift rides the fixed track (the shared modules' default)
  assert.deepEqual(cellAt(160, REF), cellAt(160, REF, DIR));
  assert.equal(fromDegOf(DIR), CELL.fromDeg);
});

test('determinism under the URL rows: the same flags and clock give the same storm, frame for frame', () => {
  const ts = [0, 0.5, 1, 4, 8];
  const a = stormAt(200, ts, { s0: 150 }).out, b = stormAt(200, ts, { s0: 150 }).out;
  assert.deepEqual(a, b);
  // a jump of ?stormt lands on the same cell as running up to it (the track is the steering's from the first frame)
  const run = stormAt(200, [0, 1 / 60, 30], { s0: 120 }).out[2].cell, jump = stormAt(200, [0], { s0: 150 }).out[0].cell;
  assert.ok(Math.hypot(run[0] - jump[0], run[1] - jump[1]) < 1e-6);
});

test('no baked drift left in v2\'s shaders: the water, the clouds and the sky read the frame\'s track (no 70 degree constant)', () => {
  const s70 = Math.sin(70 * Math.PI / 180).toFixed(6), c70 = (-Math.cos(70 * Math.PI / 180)).toFixed(6);
  const fs = wgslStruct();
  const texts = { water: WATER_DRAW_WGSL(fs, null, false), waterLite: WATER_DRAW_WGSL(fs, null, true), clouds: KEY_WGSL(fs, KEY.desktop), sky: STORM_FOG_WGSL };
  for (const [name, w] of Object.entries(texts)) {
    assert.ok(!w.includes(s70) && !w.includes(c70), `${name}: no sin/cos of 70 degrees baked in`);
  }
  assert.match(texts.water, /F\.track\.x/); assert.match(texts.sky, /F\.track/); assert.match(texts.clouds, /CL\.h\.x/);
});

test('the mist: none under its onset in fair wind, rising from 11 m/s, in the storm whatever the wind, denser in a gust', () => {
  assert.equal(mistWeight(8, 0, 1), 0); assert.equal(mistWeight(MIST.onset[0], 0, 1), 0);
  assert.ok(mistWeight(13, 0, 1) > 0.2 && mistWeight(13, 0, 1) < mistWeight(16, 0, 1));
  assert.equal(mistWeight(16, 0, 1), 1);
  assert.ok(mistWeight(8, 1, 1) >= MIST.storm * 0.8, 'the storm\'s outflow carries mist at 8 m/s');
  assert.equal(mistWeight(3, 1, 1), 0, 'a lull ahead of the line: none');
  assert.ok(mistWeight(14, 0, 1.3) > mistWeight(14, 0, 1) * 1.3, 'a 30 % gust: denser');
  assert.equal(mistWeight(14, 0, 3), mistWeight(14, 0, 2), 'the gust\'s share capped');
});

test('the mist follows the wind: its wisps drift along the wind at half its speed, integrated (no slide on a change)', () => {
  for (const from of [200, 290, 45]) {
    const [tx, tz] = towardOf(from), trav = Math.atan2(tz, tx);
    const d = [0, 0, 0];
    for (let i = 0; i < 600; i++) mistDrift(d, 14, trav, 1 / 60);
    assert.ok(Math.abs(d[0] - tx * 14 * MIST.speed * 10) < 1e-6 && Math.abs(d[1] - tz * 14 * MIST.speed * 10) < 1e-6);
    assert.deepEqual(mistDir(trav).map((v) => +v.toFixed(9)), [tx, tz].map((v) => +v.toFixed(9)));
  }
  const d = [5, 5, 0]; mistDrift(d, 14, 0, 5); assert.equal(d[0], 5 + 14 * MIST.speed, 'a long step (a cut) integrates at most 1 s');
});

test('the mist\'s level: the quality ladder (lighter at L2, off at L3), off under Reduced Motion, the A/B flag; its WGSL reads the row', () => {
  assert.deepEqual(LEVELS.map((l) => mistLevel({ rung: l.mist })), [1, 1, 0.5, 0]);
  assert.equal(mistLevel({ rung: 1, reduced: true }), 0);
  assert.equal(mistLevel({ rung: 0, flag: '1' }), 1); assert.equal(mistLevel({ rung: 1, flag: '0' }), 0);
  const full = mistWgsl(false), lite = mistWgsl(true);
  assert.equal((full.match(/mistLayer\(p, ang/g) ?? []).length, 2, 'desktop: two layers');
  assert.equal((lite.match(/mistLayer\(p, ang/g) ?? []).length, 1, 'the phone\'s water: one');
  const water = WATER_DRAW_WGSL(wgslStruct(), null, false);
  assert.match(water, /if \(F\.mist\.x > 0\.0\)/, 'off at 0: every pixel skips it');
  assert.match(water, new RegExp(`MI_ON = vec2f\\(${MIST.onset[0].toFixed(6)}, ${MIST.onset[1].toFixed(6)}\\)`), 'the WGSL takes the JS onset');
});

test('the spray mist is off by default; ?spray=1 restores the level\'s amount at once, ?spraymist= still works', () => {
  assert.equal(mistLevel({ rung: 1, flag: mistFlagOf(undefined, undefined) }), 0);
  assert.equal(mistLevel({ rung: 1, flag: mistFlagOf(null, null) }), 0);
  assert.equal(mistLevel({ rung: 0.5, flag: mistFlagOf('1', undefined) }), 1);
  assert.equal(mistLevel({ rung: 1, flag: mistFlagOf('0', '1') }), 0, '?spray wins');
  assert.equal(mistLevel({ rung: 0, flag: mistFlagOf(undefined, '1') }), 1);
});
