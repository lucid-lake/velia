// Speed legible with no instrument: 3, 5 and 6.5 kn read apart from the water and the sound alone. The wake's white strip
// (v2/sim/wake.js: its width and life by the speed it was made at, through the foam twin the GPU mirrors) and the hull's
// rush (src/boatAudio.js hullMix with v2/audio/speedSound.js: its level by speed, louder gaining way, quieter losing it).
// Behaviour only: the modules are called and their outputs read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeTrack, foamAtCPU, stripWidthK, stripLifeK, WAKE_SPEED, POINT_FLOATS } from '../sim/wake.js';
import { createSpeedSound, createAccelTrack, rushAccel, SPEED_SOUND } from '../audio/speedSound.js';
import { createBoatAudio } from '../../src/boatAudio.js';

const L = 7.26, BEAM = 3.15, KN = 1852 / 3600;
const SPEEDS = [3, 5, 6.5];
// a straight run north at kn for 30 s, stepped at 1/60 s as the ride does; the packed points
function run(kn) {
  const U = kn * KN, T = createWakeTrack({ length: L, beam: BEAM }), st = { x: 0, z: 0, heading: 0, u: U };
  for (let i = 0; i < 30 * 60; i++) { st.z -= U / 60; T.update(null, st, 1 / 60); }
  const pts = new Float32Array((T.trailN + 1) * POINT_FLOATS);
  return { pts, n: T.pack(pts, T.boat.x, T.boat.z) };
}
// the strip as white water: its length aft of the transom where the centre's foam is past 0.6 (where render/wake.js's
// foamVisible is solid white), and its width 3 m aft where the foam is past 0.5
function strip(kn) {
  const { pts, n } = run(kn), at = (x, aft) => foamAtCPU(pts, n, x, L / 2 + aft, { length: L, beam: BEAM })[0];
  let len = 0; for (let aft = 0; aft < 60; aft += 0.25) if (at(0, aft) > 0.6) len = aft;
  let half = 0; for (let x = 0; x < 3; x += 0.02) if (at(x, 3) > 0.5) half = x;
  return { len, width: 2 * half };
}

test('the strip\'s width and life rise with the speed it was made at, 1 at the speed v1\'s map was fitted at', () => {
  assert.equal(stripWidthK(WAKE_SPEED.refMs), 1); assert.equal(stripLifeK(WAKE_SPEED.refMs), 1);
  let w = 0, l = 0;
  for (let u = 0; u <= 5; u += 0.05) { assert.ok(stripWidthK(u) >= w && stripLifeK(u) >= l, `rises at ${u} m/s`); w = stripWidthK(u); l = stripLifeK(u); }
  assert.ok(stripWidthK(0) > 0 && stripLifeK(0) > 0 && stripWidthK(9) <= 1.4 && stripLifeK(9) <= 1.6, 'clamped');
});

test('the white strip: none at 3 kn, then longer and wider at 5 and 6.5 kn, each clearly apart', () => {
  const s = SPEEDS.map(strip);
  console.log(`  white strip length / width (m): ${SPEEDS.map((k, i) => `${k} kn ${s[i].len.toFixed(1)} / ${s[i].width.toFixed(2)}`).join(', ')}`);
  assert.equal(s[0].len, 0, '3 kn: no solid white behind her');
  assert.ok(s[1].len > 2, `5 kn: a strip (${s[1].len} m)`);
  assert.ok(s[2].len >= 1.6 * s[1].len, `6.5 kn's strip is at least 1.6× 5 kn's: ${s[2].len} vs ${s[1].len} m`);
  assert.ok(s[2].width >= 1.25 * s[1].width, `and wider: ${s[2].width} vs ${s[1].width} m`);
  // monotonic in between (4 to 7 kn by 0.25)
  let prev = -1; for (let kn = 4; kn <= 7.001; kn += 0.25) { const { len } = strip(kn); assert.ok(len >= prev, `length rises at ${kn} kn`); prev = len; }
});

// v1's boat engine with the speed feel's adjust, at a held speed (sog in kn per frame from fn(t)); the last mix
function rush(fn, seconds = 12, feel = createSpeedSound()) {
  const a = createBoatAudio({ seed: 1 }); let m;
  for (let i = 0; i <= seconds * 60; i++) {
    const t = i / 60, s = { sog: fn(t) * KN, heel: 0.05, heelDrawn: 0.05, apparentWind: { speed: 6, angle: 1.2 }, trueWind: { speed: 5, angle: 1.6 }, drive: 800, side: 600, mainFill: 1, jibFill: 1, rail: 0, simT: t };
    m = a.update(t, s, { camDist: 30, adjust: feel.adjust });
  }
  return m;
}
const dB = (x) => 20 * Math.log10(x);

test('the hull\'s rush by speed: rising, and at least 5 dB between 3, 5 and 6.5 kn at a steady speed', () => {
  const curve = []; for (let kn = 0; kn <= 7.5; kn += 0.5) curve.push(rush(() => kn, 3).gains.rush);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1], `rush rises at ${i * 0.5} kn`);
  const g = SPEEDS.map((kn) => rush(() => kn, 3)), lv = g.map((m) => dB(m.gains.rush));
  console.log(`  rush (dB re 1) ${SPEEDS.map((k, i) => `${k} kn ${lv[i].toFixed(1)} (low-pass ${Math.round(g[i].hz.hull)} Hz, rate ${g[i].rate.rush.toFixed(3)})`).join(', ')}`);
  assert.ok(lv[1] - lv[0] >= 5 && lv[2] - lv[1] >= 5, `steps ${(lv[1] - lv[0]).toFixed(1)} and ${(lv[2] - lv[1]).toFixed(1)} dB`);
  assert.ok(g[2].hz.hull > g[1].hz.hull && g[1].hz.hull > g[0].hz.hull, 'brighter with speed');
});

test('gaining way the rush is louder and brighter, losing it quieter and duller; the same speed held: v1\'s level', () => {
  const steady = rush(() => 5), up = rush((t) => 5 + Math.min(t, 12) * 0.08 - 12 * 0.08), down = rush((t) => 5 - Math.min(t, 12) * 0.08 + 12 * 0.08);
  // all three end at 5 kn: gaining 0.08 kn/s (0.04 m/s²) is a slow build; then a gust's push of 0.3 kn/s
  const gust = rush((t) => 5 + Math.min(t, 12) * 0.3 - 12 * 0.3), ease = rush((t) => 5 - Math.min(t, 12) * 0.3 + 12 * 0.3);
  console.log(`  rush at 5 kn (dB): steady ${dB(steady.gains.rush).toFixed(2)}, gaining 0.08 / 0.3 kn/s ${dB(up.gains.rush).toFixed(2)} / ${dB(gust.gains.rush).toFixed(2)}, losing ${dB(down.gains.rush).toFixed(2)} / ${dB(ease.gains.rush).toFixed(2)}`);
  assert.ok(up.gains.rush > steady.gains.rush && down.gains.rush < steady.gains.rush, 'a slow build heard');
  assert.ok(dB(gust.gains.rush) - dB(steady.gains.rush) > 1.5 && dB(steady.gains.rush) - dB(ease.gains.rush) > 2, 'a gust\'s push heard clearly');
  assert.ok(gust.rate.rush > steady.rate.rush && ease.rate.rush < steady.rate.rush, 'brighter gaining, duller losing');
  const plain = createSpeedSound(); plain.on = true;
  assert.equal(rush(() => 5, 12, plain).gains.rush, steady.gains.rush, 'deterministic');
  const g = rushAccel(1), l = rushAccel(-1);
  assert.ok(Math.abs(dB(g.gain) - dB(1 + SPEED_SOUND.accel.rush)) < 1e-9 && l.gain > 0, 'bounded both ways');
});

test('the accel track: the waves\' surge barely moves it, a frame drawn again or a jump never kicks it', () => {
  const A = createAccelTrack();
  let peak = 0;
  for (let i = 0; i < 60 * 30; i++) { const t = i / 60; const k = A.update(t, 2.6 + 0.35 * Math.sin(2 * Math.PI * t / 4.5)); if (t > 10) peak = Math.max(peak, Math.abs(k)); }
  assert.ok(peak < 0.5, `a 4.5 s surge of ±0.35 m/s: |k| ≤ ${peak.toFixed(2)}`);
  const B = createAccelTrack(); B.update(0, 2); B.update(1 / 60, 2); const k0 = B.k;
  assert.equal(B.update(1 / 60, 3), k0, 'the same t again: nothing');
  assert.equal(B.update(5, 0), 0, 'a jump (a new start): afresh');
  assert.equal(createAccelTrack().update(undefined, 3), 0, 'no clock: steady');
});
