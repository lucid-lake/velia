// BACKLOG-v2 #25 (2026-11-14): the sea across the lake (v2/sim/seaField.js), on v1's heights: the fetch map against the exact
// trace, v1's per-point weights (spectrum.js seaWeights) without allocation, the gains (1 at the boat, the open lake bigger
// seen from the bay's lee, the lee calmer seen from the open lake), v1's damping by depth, the f16 map the GPU samples, and a live
// page's spread build giving the same map as a capture's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budget } from '../../tests/helpers/budget.mjs';
import { createSeaField, pointWeights, toHalf, fromHalf, FIELD, SEA_FIELD_WGSL } from '../sim/seaField.js';
import { seaTables, seaWeights, fetchAt, hsLaw, V1_SEA } from '../sim/spectrum.js';
import { cascadeDamp } from '../sim/surface.js';
import { heightAt } from './helpers/ground.mjs';

const TRAVEL = 0.4, DW = [Math.cos(TRAVEL), Math.sin(TRAVEL)];
const field = createSeaField({ heightAt });
const t0 = performance.now(); field.update(TRAVEL); const buildMs = performance.now() - t0;

test('the f16 round trip the GPU samples (metres of fetch: 0 to 20 km)', () => {
  for (const v of [0, 1, 7.5, 312.3, 2894.4, 11802, 20000]) { const r = fromHalf(toHalf(v)); assert.ok(Math.abs(r - v) <= Math.max(1e-3, v * 1e-3), `${v} → ${r}`); }
  assert.equal(fromHalf(toHalf(-2)), -2);
});

test(`the fetch map: 128² over the lake from a 512² land mask, built in ${buildMs.toFixed(0)} ms; within a cell of the exact trace`, () => {
  budget(buildMs, 400, 'the fetch map build');
  assert.equal(field.ready, true); assert.equal(field.version, 1);
  for (const [x, z] of [[2500, -1500], [4000, -8000], [8000, -20000], [3000, -3500]]) {
    const exact = fetchAt(heightAt, x, z, DW), map = field.fetchAt(x, z);
    assert.ok(Math.abs(map - exact) < Math.max(700, 0.2 * exact), `(${x}, ${z}): map ${map.toFixed(0)} m, traced ${exact.toFixed(0)} m`);
  }
  assert.equal(field.fetchAt(-30000, -15000), 0, 'land');
  assert.equal(field.update(TRAVEL + 0.01), false, 'under 2° of turn: the map stands');
});

test('v1\'s per-point weights without allocation are spectrum.js seaWeights', () => {
  const out = [0, 0, 0, 0];
  for (const U of [3, 8, 14]) for (const [F, x, z] of [[300, 1200, -1050], [3000, 3000, -3500], [15000, 8000, -20000], [800, 0, -2500]]) {
    const S = V1_SEA, hsRef = hsLaw(U, S.lakeFetchKm * 1000), hsBay = hsLaw(U, S.bayFetchKm * 1000), sw = hsRef * S.mouth.swell * Math.min(1, Math.max(0, (U - 9) / 6));
    pointWeights(U, F, x, z, hsRef, hsBay, sw, out);
    const w = seaWeights({ U, fetchM: F, x, z });
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(out[c] - w.lake[c]) < 1e-9, `U ${U} F ${F} tile ${c}`);
    assert.ok(Math.abs(out[3] - w.bay) < 1e-9, `U ${U} F ${F} bay`);
  }
});

test('the gains: 1 at the boat; the open lake bigger from the bay\'s lee, the lee calmer from the open lake; v1\'s damping by depth', () => {
  const T = seaTables({ speedMs: 8, travelRad: TRAVEL }), g = [0, 0, 0, 0];
  field.setRef({ U: 8, T, x: 1200, z: -1050 });   // the Sail start, in Emerald Bay
  field.gainsAt(1200, -1050, 100, g); for (let c = 0; c < 4; c++) assert.ok(Math.abs(g[c] - 1) < 1e-6, `at the boat (the f32 uniform), tile ${c}: ${g[c]}`);
  field.gainsAt(1215, -1040, 100, g); assert.ok(g.every((v) => Math.abs(v - 1) < 0.05), `beside the boat ≈ 1 (${g.map((v) => v.toFixed(3))})`);
  field.gainsAt(4000, -8000, 100, g); assert.ok(g[0] > 3 && g[1] > 2 && g[2] > 2, `the open lake from the bay: ${g.map((v) => v.toFixed(2))}`);
  assert.ok(g[0] <= FIELD.rmax, 'capped');
  field.setRef({ U: 8, T, x: 3000, z: -3500 });   // the open lake beyond the mouth
  field.gainsAt(600, -650, 100, g); assert.ok(g[0] < 0.5 && g[1] < 0.5 && g[2] < 0.5, `the bay's lee from the open lake: ${g.map((v) => v.toFixed(2))}`);
  // the depth: the swell (the 600 m tile) dies under 14 m, the chop (the rest) under 2 m, as v1's cascadeDamp
  field.setRef({ U: 8, T, x: 3000, z: -3500 });
  for (const d of [0, 1, 3, 8, 14, 40]) {
    field.gainsAt(3000, -3500, d, g); const dm = cascadeDamp(d);
    assert.ok(Math.abs(g[0] - dm[0]) < 1e-6 && Math.abs(g[1] - dm[1]) < 1e-6 && Math.abs(g[3] - dm[1]) < 1e-6, `depth ${d} m: ${g.map((v) => v.toFixed(3))}`);
  }
  field.off = true; field.gainsAt(4000, -8000, 1, g); assert.deepEqual(g, [1, 1, 1, 1], 'off: the old water'); field.off = false;
});

test('a live page\'s spread build (a budget a frame) gives the capture\'s map, byte for byte', () => {
  const live = createSeaField({ heightAt });
  let frames = 0; while (!live.update(TRAVEL, 8192)) frames++;
  assert.ok(frames > 20, `spread over ${frames} frames`);
  assert.deepEqual(live.half, field.half);
});

test('the shader\'s side declares its two bindings and the gains function', () => {
  const w = SEA_FIELD_WGSL(10);
  assert.match(w, /@binding\(10\) var<uniform> SF: SeaField/); assert.match(w, /@binding\(11\) var tFetch: texture_2d<f32>/);
  assert.match(w, /fn seaGains\(x: f32, z: f32, dmp: vec2f\) -> vec4f/); assert.match(w, /fn seaDamp\(depth: f32\) -> vec2f/);
});
