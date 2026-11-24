// The wind field's modifiers (src/wind-modifiers.js, refactor Phase 2 step 4): the gust cells and the storm's outflow
// run as a list, in order, on sample(), gustAt(), toTexture() and the worker's field, with the numbers main computed
// before the list (tests/fixtures/wind-modifiers.json, recorded at 5f239e7: sha-256 of the exact doubles and floats).
// Run: node --test tests/wind-modifiers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { makeTerrain } from '../src/sim/terrain.js';
import { WindField, dayWind } from '../src/sim/wind.js';
import { WIND_MODIFIERS, gustCells, stormOutflow } from '../src/sim/wind-modifiers.js';
import { stormWindAt, applyStorm } from '../src/sim/weather/stormWind.js';
import { windState, applyWindState, fillWindTexture, newWindBuffers } from '../src/sim/wind-texture.js';
import { CONFIGS, GRID, TIMES, TEX } from './fixtures/wind-modifiers.cases.mjs';

const MAIN = JSON.parse(readFileSync(new URL('./fixtures/wind-modifiers.json', import.meta.url), 'utf8'));
const terrain = makeTerrain({ seed: 1 });
const hash = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

for (const c of CONFIGS) {
  test(`the wind is main's, bit for bit, over a grid and over time: ${c.name}`, () => {
    const f = c.make({ WindField, dayWind, terrain }), rec = MAIN[c.name];
    TIMES.forEach((t, n) => {
      const a = new Float64Array(GRID.length * 5);
      GRID.forEach(([x, z], k) => { const s = f.sample(x, z, t); a.set([s.vx, s.vz, s.speed, s.dirDeg, f.gustAt(x, z, t)], 5 * k); });
      assert.equal(hash(a), rec.samples[n], `sample() and gustAt() at t = ${t}`);
      assert.equal(hash(f.toTexture(TEX.size, TEX.extent, t, TEX.cx, TEX.cz)), rec.tex[n], `toTexture() at t = ${t}`);
      // the worker's path: a second field set to this one's state
      const w = new WindField({ seed: f.seed }); if (c.terrain) w.setTerrain(terrain.heightAt);
      applyWindState(w, structuredClone(windState(f, t)));
      const b = fillWindTexture(w, t, 1024, -1024, newWindBuffers());
      assert.equal(hash(b.wind) + ':' + hash(b.mean), rec.worker[n], `the worker's texture at t = ${t}`);
    });
  });
}

test('the list: the gust cells, then the storm; each on only with its state, carried to the worker', () => {
  assert.deepEqual(WIND_MODIFIERS.map((m) => [m.id, m.stage, m.key]), [['cells', 'gust', 'cells'], ['storm', 'flow', 'storm']]);
  const f = new WindField({ seed: 2 });
  assert.deepEqual(f.modifiers.map((m) => m.id), ['cells', 'storm']);
  assert.notEqual(f.modifiers, WIND_MODIFIERS, 'a field owns its list');
  assert.ok(!gustCells.on(f) && !stormOutflow.on(f));
  f.cells = { ...f.cells, cellM: 400 }; f.setStorm({ s0: 120, t0: 0, rate: 1, ref: [0, 0], seed: 1 });
  assert.ok(gustCells.on(f) && stormOutflow.on(f));
  const s = windState(f, 10), g = new WindField({ seed: 2 });
  applyWindState(g, structuredClone(s));
  assert.deepEqual(g.cells, f.cells); assert.deepEqual(g.storm, f.storm);
  // the storm's per-frame part is made once per state and time (sample() allocates nothing per point)
  assert.equal(stormOutflow.frame(f, 10), stormOutflow.frame(f, 10));
  assert.notEqual(stormOutflow.frame(f, 11), stormOutflow.frame(f, 10));
  const fn = stormOutflow.frame(f, 11); f.setStorm({ ...f.storm }); assert.notEqual(stormOutflow.frame(f, 11), fn, 'a new state, a new frame');
});

test('flow modifiers run in list order on sample() and toTexture()', () => {
  const ST = { s0: 0, t0: 0, rate: 1, ref: [300, -200], seed: 5 }, t = 150;
  const rot = { id: 'rot', key: 'rotOn', stage: 'flow', on: (f) => !!f.rotOn, frame: () => (vx, vz, x, z, out) => { out[0] = -vz * 0.9; out[1] = vx * 1.1; return out; } };
  const rotOf = ([vx, vz]) => [-vz * 0.9, vx * 1.1];
  const make = (mods) => { const f = new WindField({ seed: 4, base: { dirDeg: 230, speedMs: 7 } }); f.modifiers = mods; f.setStorm(ST); f.rotOn = true; return f; };
  const bare = make([]);
  const stormOf = ([vx, vz], x, z) => applyStorm(vx, vz, stormWindAt(ST, x, z, t));
  for (const [mods, expect] of [
    [[stormOutflow, rot], (v, x, z) => rotOf(stormOf(v, x, z))],
    [[rot, stormOutflow], (v, x, z) => stormOf(rotOf(v), x, z)],
  ]) {
    const f = make(mods);
    for (const [x, z] of GRID) {
      const b = bare.sample(x, z, t), s = f.sample(x, z, t), [vx, vz] = expect([b.vx, b.vz], x, z);
      assert.equal(s.vx, vx); assert.equal(s.vz, vz); assert.equal(s.speed, Math.hypot(vx, vz));
    }
    const n = 12, ext = 3000, cx = 512, cz = -512, b = bare.toTexture(n, ext, t, cx, cz), a = f.toTexture(n, ext, t, cx, cz);
    const want = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = j * n + i, x = cx - ext / 2 + (i + 0.5) * ext / n, z = cz - ext / 2 + (j + 0.5) * ext / n;
      const v = expect([b[2 * p], b[2 * p + 1]], x, z);
      want[2 * p] = v[0]; want[2 * p + 1] = v[1];
    }
    assert.deepEqual(a, want, mods.map((m) => m.id).join(' → '));
  }
});

test('gust modifiers multiply the raw gust, in list order, and an off one changes nothing', () => {
  const half = { id: 'half', key: 'halfOn', stage: 'gust', on: (f) => !!f.halfOn, at: () => 0.5, raster: (f, T) => new Float64Array(T.px.length).fill(0.5) };
  const f = new WindField({ seed: 9, base: { dirDeg: 200, speedMs: 6 }, cells: true });
  const raw = GRID.map(([x, z]) => f.gustRaw(x, z, 40)), tex = f.toTexture(10, 2000, 40, 0, 0);
  f.modifiers = [...f.modifiers, half];
  assert.deepEqual(GRID.map(([x, z]) => f.gustRaw(x, z, 40)), raw, 'off: the same numbers');
  assert.deepEqual(f.toTexture(10, 2000, 40, 0, 0), tex);
  f.halfOn = true;
  GRID.forEach(([x, z], k) => assert.equal(f.gustRaw(x, z, 40), raw[k] * 0.5));
  f.modifiers = [];
  const plain = GRID.map(([x, z]) => f.gustRaw(x, z, 40));
  f.modifiers = [gustCells];
  GRID.forEach(([x, z], k) => assert.equal(f.gustRaw(x, z, 40), raw[k], 'the cells alone: main\'s raw gust'));
  assert.ok(plain.some((v, k) => v !== raw[k]), 'the cells change the gust');
});
