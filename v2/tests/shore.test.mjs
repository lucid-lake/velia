// #56 M3, the shore (v2/sim/shoreField.js, v2/render/shore.js): the bake is deterministic and round-trips; the committed field
// fits the GPU buffer and covers the bay's beaches; the trains never exceed the 0.42 d limit and break only where the free wave
// reaches it; a calm day laps (no whitewater anywhere); the swash runs up and dries; the WGSL passes the Safari lint; with no
// shore in view the field is off (the shaders' one uniform branch: zero cost).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { ground } from './helpers/ground.mjs';   // v2's own height field (v2/terrain/sample.js), every grid in
import { bakeShore, encodeShore, decodeShore, gpuWords, sampleShore, shoreWaves, swash, shoreParams, SHORE, SHORE_BAKE, PARAM_WORDS } from '../sim/shoreField.js';
import { SHORE_READ_WGSL, SPRAY_WGSL, SHORE_STUB_WGSL, SHORE_CAP, createShore } from '../render/shore.js';
import { lintWgsl } from '../engine/wgsl-lint.js';
import { hsLaw } from '../sim/spectrum.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = ground('full');
const FIELD = decodeShore(gunzipSync(readFileSync(resolve(ROOT, 'v2/assets/shore/shore.vsf.gz'))));
const HEAD_BEACH = [-512, 108];   // the bay's head beach, 4 m off its waterline (src/waters/tahoe-emerald.json headBeach)
// the sea the shaders see at the shore: v1's drawn Hs for the wind on the lake's longest fetch (an upper bound for any beach in the box)
const hsMax = (U) => hsLaw(U, 25000) * 2.5;   // the drawn sea (v1's feel gain: up to 2.5 in the bay)

test('the bake is deterministic: a box baked twice gives the same bytes, and the file round-trips', async () => {
  const S = await SP;
  const box = { x0: -768, z0: -128, w: 192, h: 160 };   // the bay's head: the beach, the house's shore
  const a = encodeShore(bakeShore({ heightAt: (x, z) => S.height(x, z), box }));
  const b = encodeShore(bakeShore({ heightAt: (x, z) => S.height(x, z), box }));
  assert.equal(a.length, b.length);
  assert.ok(a.every((v, i) => v === b[i]), 'two bakes differ');
  const d = decodeShore(a);
  assert.ok(d.head.nTiles > 0 && d.head.nEmit > 0, `tiles ${d.head.nTiles}, emitters ${d.head.nEmit}`);
  const again = encodeShore(d);
  assert.ok(again.every((v, i) => v === a[i]), 'decode → encode differs');
});

test('the committed field: the bay\'s box, fits the GPU buffer, holds the head beach with a front running onto it', () => {
  const H = FIELD.head;
  assert.equal(H.x0, SHORE_BAKE.x0); assert.equal(H.z0, SHORE_BAKE.z0); assert.equal(H.texel, SHORE_BAKE.texel);
  assert.ok(H.nTiles > 500 && H.nTiles < 4000, `${H.nTiles} tiles`);
  const words = gpuWords(FIELD);
  assert.ok(words.byteLength <= SHORE_CAP, `${words.byteLength} B over ${SHORE_CAP}`);
  for (let i = 0; i < PARAM_WORDS; i++) assert.equal(words[i], 0, 'the params start off');
  const t = sampleShore(FIELD, ...HEAD_BEACH);
  assert.ok(t && t.fade > 0.5, `fade ${t?.fade}`);
  // the front runs toward the land (west of the beach's water): the travel time falls toward the shore
  const off = sampleShore(FIELD, HEAD_BEACH[0] + 12, HEAD_BEACH[1]);
  assert.ok(off.tau1 > t.tau1, `τ ${off.tau1.toFixed(2)} offshore vs ${t.tau1.toFixed(2)} near`);
  assert.ok(t.dx < -0.8, `dir ${t.dx.toFixed(2)}, ${t.dz.toFixed(2)}`);
  assert.equal(sampleShore(FIELD, 900, -900), null, 'the deep bay holds no field');
});

// every kept texel's centre (a stride of them), its depth from v1's heights
async function points(stride = 7) {
  const S = await SP, H = FIELD.head, out = [];
  for (let J = 0; J < H.tilesZ; J++) for (let I = 0; I < H.tilesX; I++) {
    if (!FIELD.index[J * H.tilesX + I]) continue;
    for (let k = (I + J) % stride; k < 256; k += stride) {
      const x = H.x0 + (I * 16 + (k & 15) + 0.5) * H.texel, z = H.z0 + (J * 16 + (k >> 4) + 0.5) * H.texel;
      out.push([x, z, S.height(x, z), sampleShore(FIELD, x, z)]);
    }
  }
  return out;
}

test('the trains: a ≤ 0.42 d everywhere; breaking only where the free wave reaches 0.85 of the limit; whitewater at wind 4 on an exposed beach', async () => {
  const pts = await points();
  const p = shoreParams({ U: 10.8, travelRad: Math.PI, fetchM: 6000 });
  let broke = 0, n = 0;
  for (const [x, z, g, tex] of pts) {
    if (!tex || g >= 0) continue;
    const d = -g;
    for (const t of [0, 0.7, 1.9, 3.3]) {
      const w = shoreWaves(x, z, d, hsMax(10.8), t, tex, p); n++;
      assert.ok(w.a0 <= SHORE.gamma * d + 1e-9, `a ${w.a0} over 0.42 d at ${x}, ${z} (d ${d})`);
      if (w.breaking > 0) { broke++; assert.ok(w.aFree >= SHORE.breakLo * SHORE.gamma * d - 1e-9, `breaking at d ${d} with a free ${w.aFree}`); }
      if (d > SHORE.dIn) assert.equal(w.y, 0, 'no train past dIn');
    }
  }
  assert.ok(n > 10000 && broke > 50, `${broke} breaking of ${n}`);
  // the head beach at wind 4 onshore breaks within a wave period somewhere in its surf zone
  const S = await SP; let foam = 0;
  for (let s = 0; s < 30; s++) {
    const x = HEAD_BEACH[0] + 6 - s * 0.4, z = HEAD_BEACH[1] + 7 - s * 0.12, d = -S.height(x, z), tex = sampleShore(FIELD, x, z);
    if (!tex || d <= 0) continue;
    for (let t = 0; t < 3; t += 0.1) foam = Math.max(foam, shoreWaves(x, z, d, hsLaw(10.8, 6000) * 2, t, tex, p).foam);
  }
  assert.ok(foam > 0.3, `head beach foam ${foam}`);
});

test('a calm day laps: wind 1 (5.5 kn) gives no whitewater anywhere, and the swash still runs up a few centimetres', async () => {
  const pts = await points(5);
  const U = 2.83, p = shoreParams({ U, travelRad: 0, fetchM: 25000 });
  let maxR = 0; const Rs = [];
  for (const [x, z, g, tex] of pts) {
    if (!tex) continue;
    for (const t of [0, 0.4, 1.1, 2.6]) {
      if (g < 0) { const w = shoreWaves(x, z, -g, hsMax(U), t, tex, { ...p, dirX: tex.dx, dirZ: tex.dz }); assert.equal(w.foam, 0, `foam at ${x}, ${z}`); assert.equal(w.breaking, 0); }
      else { const R = swash(x, z, g, hsMax(U), t, tex, { ...p, dirX: tex.dx, dirZ: tex.dz }).R; maxR = Math.max(maxR, R); if (R > 0) Rs.push(R); }
    }
  }
  Rs.sort((a, b) => a - b);
  const med = Rs[Rs.length >> 1];
  assert.ok(maxR > 0.02 && maxR <= SHORE.runup[1] && med < 0.15, `calm run-up: median ${med}, max ${maxR}`);
});

test('the swash: the film rises and drains over a period, the sand dries behind it, never above the run-up', () => {
  const tex = { tau0: 3, tau1: 3, dx: -0.7, dz: 0.7, rt: 1, beta: 0.1, fade: 1 };
  const p = shoreParams({ U: 10.8, travelRad: Math.atan2(0.7, -0.7), fetchM: 6000 });
  const T = 2 * Math.PI / p.w0;
  let wetMax = 0, dryMin = 1, thMax = 0, R = 0;
  for (let t = 0; t < 2 * T; t += T / 50) {
    const s = swash(0, 0, 0.03, 0.43, t, tex, p); R = s.R;
    thMax = Math.max(thMax, s.th); wetMax = Math.max(wetMax, s.wet); dryMin = Math.min(dryMin, s.wet);
    assert.ok(s.th <= s.R + 1e-9);
  }
  assert.ok(R > 0.05 && R <= SHORE.runup[1], `R ${R}`);
  assert.ok(thMax > 0.02 && wetMax === 1 && dryMin < 1, `film ${thMax}, wet ${dryMin}–${wetMax}`);
  assert.equal(swash(0, 0, R * 1.6, 0.43, 0, tex, p).th, 0);
});

test('the WGSL passes the Safari lint (the water\'s read, the lite read, the spray, the stub)', () => {
  const fs = 'struct Frame { viewProj: mat4x4f }';
  for (const [name, code] of [['read', SHORE_READ_WGSL(15)], ['lite', SHORE_READ_WGSL(15, true)], ['spray', SPRAY_WGSL(fs)], ['stub', SHORE_STUB_WGSL]]) assert.deepEqual(lintWgsl(code, name), [], name);
});

test('zero cost off-shore: no tile in view or none in range leaves the field off (the shaders skip on one word); the spray only in strong wind', () => {
  const writes = [];
  const device = { createBuffer: (d) => ({ size: d.size, label: d.label }), createBindGroupLayout: () => ({}), createBindGroup: () => ({}), createPipelineLayout: () => ({}),
    queue: { writeBuffer: (b, off, data) => writes.push({ b, off, w: new Uint32Array(data.buffer ?? data, data.byteOffset ?? 0, Math.min(32, (data.byteLength ?? 0) >> 2)).slice() }) } };
  globalThis.GPUBufferUsage ??= { STORAGE: 128, COPY_DST: 8 }; globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  const reg = { shader: () => ({}), add: () => {}, get: () => ({}) };
  const S = createShore({ device, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: '', sky: { skyBGL: {} }, terrainBGL: {}, hdrTarget: {} });
  S.land(encodeShore(FIELD));
  const look = (eye, at) => {   // a view-projection looking from eye to at (a plain perspective, z into the screen)
    const f = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]], l = Math.hypot(...f); f.forEach((v, i) => { f[i] = v / l; });
    const r = [-f[2], 0, f[0]], rl = Math.hypot(...r); r.forEach((v, i) => { r[i] = v / rl; });
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const k = 1 / Math.tan(0.45), m = new Float64Array(16);
    const rows = [r.map((v) => v * k), u.map((v) => v * k), f, f];
    for (let i = 0; i < 4; i++) { for (let j = 0; j < 3; j++) m[j * 4 + i] = rows[i][j]; m[12 + i] = -(rows[i][0] * eye[0] + rows[i][1] * eye[1] + rows[i][2] * eye[2]); }
    m[2] = -f[0] * 0.001; m[6] = -f[1] * 0.001; m[10] = -f[2] * 0.001; m[14] = 0.5;   // reversed z's row (the planes use rows 0, 1, 3)
    return m;
  };
  const wind = { speedMs: 5, travelRad: 0, fetchM: 6000 };
  S.update({ eye: [-480, 5, 80], viewProj: look([-480, 5, 80], [-523, 0, 121]), wind });
  assert.equal(S.stats.on, true, 'the head beach in view');
  assert.equal(S.stats.sprayInstances, 0, 'no spray at 5 m/s');
  S.update({ eye: [-480, 5, 80], viewProj: look([-480, 5, 80], [-523, 0, 121]), wind: { ...wind, speedMs: 12 } });
  assert.ok(S.stats.sprayInstances > 0, 'spray at 12 m/s near a beach');
  S.update({ eye: [20000, 5, -20000], viewProj: look([20000, 5, -20000], [25000, 0, -25000]), wind });
  assert.equal(S.stats.on, false, 'the open lake: off');
  assert.equal(writes.at(-1).w[0], 0, 'the on word written 0');
  S.on = false;
  S.update({ eye: [-480, 5, 80], viewProj: look([-480, 5, 80], [-523, 0, 121]), wind });
  assert.equal(S.stats.on, false, 'the A/B switch');
});
