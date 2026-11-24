// The water's wind texture off the main thread (src/wind-texture.js, src/wind-worker.js): a second
// field set to the first's state fills the same bits, for a steady wind, Tahoe's day, a level blowing in and the first
// gust; the half floats are three.js's. Run: node --test tests/wind-texture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils } from 'three';
import { makeTerrain } from '../src/sim/terrain.js';
import { WindField, dayWind, firstGustFor } from '../src/sim/wind.js';
import { windState, applyWindState, fillWindTexture, toHalf, newWindBuffers } from '../src/sim/wind-texture.js';

const terrain = makeTerrain({ seed: 1 });
const same = (a, b) => { let d = 0; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) d++; return d; };

test('toHalf is three.js toHalfFloat, bit for bit', () => {
  const vals = [0, -0, 1e-9, -3e-7, 6.1e-5, 0.5, 1, -1, 3.14159, 12.75, 65504, 70000, -70000, NaN];
  for (let i = 0; i < 20000; i++) vals.push((Math.sin(i * 12.9898) * 43758.5453 % 1) * 10 ** ((i % 12) - 6));
  for (const v of vals) assert.equal(toHalf(v), DataUtils.toHalfFloat(v), `value ${v}`);
});

for (const [name, opts, act] of [
  ['steady', { seed: 7, base: { dirDeg: 270, speedMs: 6 }, gust: { strength: 0.35, scaleM: 300, periodS: 40 }, shift: { deg: 10, periodS: 120 } }, null],
  ['Tahoe\'s day, a level blowing in, the first gust, the readable shifts', { seed: 1, ...dayWind(18.75, { seed: 1 }), level: 3, shifts: true, firstGust: firstGustFor({ x: 1200, z: -1050, headingDeg: 251 }) }, (w) => w.setLevel(4, { t: 30, at: { x: 1200, z: -1050 } })],
]) {
  test(`a worker's field set to the page's state fills the same texture: ${name}`, () => {
    const page = new WindField(opts); page.setTerrain(terrain.heightAt);
    const worker = new WindField({ seed: opts.seed }); worker.setTerrain(terrain.heightAt);
    if (act) { page.at(20); act(page); }
    if (opts.shifts) assert.ok(page.shifts, 'the shifts are on');
    for (const [t, cx, cz] of [[40, 1024, -1024], [52.5, 1024, -1024], [61, 1536, -1024]]) {
      const a = fillWindTexture(page, t, cx, cz, newWindBuffers());
      const s = structuredClone(windState(page, t));
      applyWindState(worker, s);
      const b = fillWindTexture(worker, t, cx, cz, newWindBuffers());
      assert.equal(same(a.wind, b.wind), 0, `t ${t}: wind texels differ`);
      assert.equal(same(a.mean, b.mean), 0, `t ${t}: mean texels differ`);
    }
  });
}
