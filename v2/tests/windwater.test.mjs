// audit W1–W3, the wind on v2's water (v2/render/windWater.js, v2/sim/windTex.js): v1's gust weight (none under 3 % over the
// mean, v1's gustVisual inside, the crisp contour and the fresh front), the whitecaps' gates on the LOCAL wind (a gust at
// 11 m/s caps, a lee under 6 m/s does not), the wind texture as v1 fills it (the same half floats, packed for the GPU), its
// cadence in a capture (deterministic) and the lanes' gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gustWeight, capGate, GUST_FX, BITS, WIND_WATER_WGSL } from '../render/windWater.js';
import { createWindTex, windTexLive, EVERY_STEPS, WIND_TEX } from '../sim/windTex.js';
import { gustVisual } from '../../src/sim/water-spectrum.js';
import { WindField } from '../../src/sim/wind.js';
import { fillWindTexture, newWindBuffers } from '../../src/sim/wind-texture.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { laneAt } from '../render/spume.js';
import { lintWgsl } from '../engine/wgsl-lint.js';

test('W1: the gust weight is v1\'s: none under 3 % over the mean, v1\'s gustVisual × 1.45 inside, the crisp edge, the front', () => {
  for (const r of [0.6, 0.9, 1.0, 1.02]) assert.equal(gustWeight(6 * r, 6, 6 * r), 0, `ratio ${r}`);
  // no front (the wind downwind as strong), under the crisp contour: v1's gustVisual × 1.45
  assert.ok(Math.abs(gustWeight(6.24, 6, 6.24 * 1.0) - Math.min(1, gustVisual(6.24, 6) * GUST_FX.gain)) < 1e-12);
  // past the crisp contour (1.075): at least 0.9
  assert.ok(gustWeight(6 * 1.08, 6, 6 * 1.08) >= 0.9 - 1e-12);
  // a fresh front (the wind 28 m downwind still the old air) adds up to 0.5
  assert.ok(gustWeight(6 * 1.06, 6, 5.4) > gustWeight(6 * 1.06, 6, 6 * 1.06) + 0.25);
  // calm air: the weight fades with v1's onset (0.6–1.4 m/s)
  assert.equal(gustWeight(0.5, 0.3, 0.5), 0);
});

test('W2: the whitecaps gate on the local wind (#56 M1\'s onset, 4–8 m/s): a gust\'s 9 m/s caps, a lee\'s 3.5 m/s does not', () => {
  assert.equal(capGate(3.5), 0); assert.equal(capGate(3.9), 0);
  assert.ok(capGate(6) > 0 && capGate(6) < 1);
  assert.equal(capGate(9), 1); assert.equal(capGate(14), 1);
});

test('W3: the lanes need 3 m/s of local wind and are full by 8', () => {
  assert.equal(Math.abs(laneAt(2300, -1400, 2.9, 0.5, 100)), 0);
  let any = 0; for (let i = 0; i < 50; i++) any = Math.max(any, Math.abs(laneAt(2300 + i * 1.3, -1400, 9, 0.5, 100)));
  assert.ok(any > 0.3);
});

const field = () => { const f = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, level: 3, cells: true }); f.setTerrain(() => -10); return f; };

test('the wind texture: v1\'s fill (the same half floats), packed four a texel for the GPU; a capture fills on a fixed cadence', () => {
  const f = field(), W = createWindTex({ field: f });
  assert.equal(W.update(100, 2300, -1400), true, 'the first frame fills');
  assert.deepEqual([...W.centre], [2048, -1536], 'snapped to 512 m');
  const ref = fillWindTexture(field(), 100, 2048, -1536, newWindBuffers());
  for (const k of [0, 1, 777, 32768, WIND_TEX * WIND_TEX - 1]) {
    assert.equal(W.packed[4 * k], ref.wind[2 * k]); assert.equal(W.packed[4 * k + 1], ref.wind[2 * k + 1]); assert.equal(W.packed[4 * k + 2], ref.mean[k]);
  }
  // little-endian pairs: the GPU's pack2x16float(wind x, wind z) word
  const u32 = new Uint32Array(W.packed.buffer);
  assert.equal(u32[0] & 0xffff, ref.wind[0]); assert.equal(u32[0] >>> 16, ref.wind[1]);
  const fills = W.fills;
  for (let i = 1; i < EVERY_STEPS; i++) W.update(100 + i / 120, 2300, -1400);
  assert.equal(W.fills, fills, 'no fill between the cadence\'s steps');
  W.update(100 + EVERY_STEPS / 120, 2300, -1400);
  assert.equal(W.fills, fills + 1, 'the cadence\'s fill');
  W.update(101, 2900, -1400);
  assert.equal(W.fills, fills + 2, 'a new centre fills at once');
  // uploads only when new texels wait
  const writes = []; const q = { writeBuffer: (...a) => writes.push(a) };
  assert.equal(W.upload(q, {}), true); assert.equal(W.upload(q, {}), false); assert.equal(writes.length, 1);
  assert.equal(writes[0][4], WIND_TEX * WIND_TEX * 8);
});

test('a capture never waits on the worker: ?headless=1 and a ?filmui=1 film fill in place, on the sim\'s steps', () => {
  // the goldens' film frames (v2-hud-full, v2-hud-calm) are live pages on the film clock: the worker's fills landed on the wall
  // clock, a different film frame each run (59 px run to run, 2026-11-14)
  assert.equal(windTexLive({ headless: true }), false, 'a headless capture');
  assert.equal(windTexLive({ headless: false, filmui: true }), false, 'a ?filmui=1 film');
  assert.equal(windTexLive({ headless: true, filmui: true }), false);
  assert.equal(windTexLive({ headless: false }), true, 'a live page uses the worker');
  assert.equal(windTexLive({ headless: false, filmui: '0' }), true);
  // a capture's texture: no worker made even when one is offered; every fill done inside update(), on the same steps each run
  const run = () => {
    let made = 0;
    const W = createWindTex({ field: field(), live: false, makeWorker: () => { made++; return { postMessage() {}, terminate() {} }; } });
    const at = [];
    for (let i = 0; i < 2 * EVERY_STEPS + 1; i++) if (W.update(100 + i / 120, 2300, -1400)) { at.push(i); W.upload({ writeBuffer() {} }, {}); }
    return { made, at, fills: W.fills, packed: W.packed.slice() };
  };
  const a = run(), b = run();
  assert.equal(a.made, 0, 'no worker in a capture');
  assert.deepEqual(a.at, [0, EVERY_STEPS, 2 * EVERY_STEPS], 'the first frame, then the fixed cadence');
  assert.equal(a.fills, 3);
  assert.deepEqual(b.at, a.at); assert.deepEqual(b.packed, a.packed, 'two runs, the same texels');
});

test('the WGSL passes the Safari lint; the switches are bits', () => {
  assert.deepEqual(Object.values(BITS), [1, 2, 4, 8]);
  const head = 'struct Frame { viewProj: mat4x4f, cam: vec4f, res: vec4f, wind: vec4f, spume: vec4f, windfx: vec4f }\n@group(0) @binding(0) var<uniform> F: Frame;\n';
  assert.deepEqual(lintWgsl(head + WIND_WATER_WGSL(13), 'wind'), []);
});
