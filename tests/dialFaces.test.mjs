// The instruments' faces (src/stations/sloop/dialFaces.js; feat/cockpit-dials): what they print and when they redraw. Pure parts only (the
// drawing needs a canvas: tools/cockpit_shots.mjs --dials shows it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACES, FaceClock, windRead, windKey, chartKey } from '../src/stations/sloop/dialFaces.js';

const D = Math.PI / 180;
const S = (o = {}) => ({ apparentWind: { angle: -31.6 * D, speed: 6 }, trueWind: { angle: -50 * D }, boomAngle: 20 * D, jibAngle: 15 * D, mainFill: 1, jibFill: 1, mainStall: 0, jibStall: 0, rudderAngle: 0, ...o });

test('the wind face reads AWA with its side and AWS in knots, as the dial\'s plate does', () => {
  assert.deepEqual(windRead(S()), { awa: '32', side: 'P', aws: '11.7' });
  assert.equal(windRead(S({ apparentWind: { angle: 2 * D, speed: 1 } })).side, '', 'dead ahead: no side');
  assert.equal(windRead(S({ apparentWind: { angle: 90 * D, speed: 1 } })).side, 'S');
});

test('the wind key changes with what the face shows, not with noise under it', () => {
  const k = windKey(S());
  assert.equal(windKey(S({ boomAngle: 20.2 * D, apparentWind: { angle: -31.8 * D, speed: 6.01 } })), k, 'sub-degree and sub-tenth noise: no redraw');
  assert.notEqual(windKey(S({ boomAngle: 23 * D })), k, 'the boom moved');
  assert.notEqual(windKey(S(), { night: true }), k, 'night');
  assert.notEqual(windKey(S(), { grow: true }), k, 'grow');
  assert.equal(windKey(S({ mainFill: 0.5 }), { t: 1 }) === windKey(S({ mainFill: 0.5 }), { t: 1.2 }), false, 'a luffing sail flutters: its phase redraws');
});

test('the chart key: HDG, SOG, DPT, the alarm', () => {
  const r = { hdg: '225', sog: '5.3', dpt: '21', alarm: 0 };
  assert.equal(chartKey(r), chartKey({ ...r }));
  assert.notEqual(chartKey({ ...r, alarm: 1 }), chartKey(r));
  assert.equal(chartKey(null), '');
});

test('the clock: a changed key redraws at most 4 Hz steady, 10 Hz while trimming; the chart beats at 1 Hz', () => {
  const run = (busy) => { const c = new FaceClock(); let n = 0; for (let i = 0; i < 120; i++) if (c.tick(1 / 60, `k${i}`, { busy })) n++; return n; };
  assert.ok(Math.abs(run(false) - 2 * FACES.steadyHz) <= 1, `steady: ${run(false)} draws in 2 s`);
  assert.ok(Math.abs(run(true) - 2 * FACES.busyHz) <= 1, `trimming: ${run(true)} draws in 2 s`);
  const still = new FaceClock(); let n = 0; for (let i = 0; i < 600; i++) if (still.tick(1 / 60, 'same')) n++;
  assert.equal(n, 1, 'an unchanged face draws once');
  const chart = new FaceClock({ beat: FACES.beatS }); n = 0; for (let i = 0; i < 600; i++) if (chart.tick(1 / 60, 'same')) n++;
  assert.ok(n >= 10 && n <= 11, `the chart's map beat: ${n} in 10 s`);
  const f = new FaceClock(); f.tick(1 / 60, 'a'); assert.equal(f.tick(1 / 60, 'a', { force: true }), true, 'forced');
});
