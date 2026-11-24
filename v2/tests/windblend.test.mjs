// fix(v2) shadow stepping (2026-11-18, a week-3 viewer: "the shadows stutter"): the gust patches' dark water stepped a texel on each
// fill of the wind texture and held (every 30th film frame; every worker round trip live). sim/windTex.js now keeps the two newest
// fills and render/windWater.js cross-fades them each frame: what the water reads moves every frame, never jumps at a fill, a late
// fill holds, a cut switches at once, and the whole thing is deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindTex, EVERY_STEPS, WIND_TEX, SNAP_M, MAX_FADE_S } from '../sim/windTex.js';
import { blendTexel, WIND_BLEND_WGSL } from '../render/windWater.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { lintWgsl } from '../engine/wgsl-lint.js';

const fromHalf = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + m / 1024); };
const field = () => { const f = new WindField({ seed: 3, bay: CURRENT_WATERS.windBay, base: { dirDeg: 270, speedMs: 8 }, gust: { strength: 0.5, scaleM: 200, periodS: 400 } }); f.setTerrain(() => -10); return f; };
// a stand-in for the GPU: the two slots' texels as uploaded, and the blended texel the water reads at (i, j)
function gpu(W) {
  const slots = [null, null];
  const q = { writeBuffer: (buf, o, data) => { slots[buf] = new Uint16Array(data.slice(0)); } };
  const at = (k) => (i, j) => { const s = slots[k], b = 4 * (j * WIND_TEX + i); return [fromHalf(s[b]), fromHalf(s[b + 1]), fromHalf(s[b + 2])]; };
  return { upload: () => W.upload(q, [0, 1]), read: (t, i, j) => { const b = W.blend(t); return b.fills > 1 ? blendTexel(at(b.prev), at(b.slot), i, j, b.w, b.off) : at(b.slot)(i, j); }, slots };
}
const DT = 1 / 120;   // the sim's step; a film frame at 30 fps is 4 of them at 1 x, here one frame a step

test('a capture\'s fills are cross-faded: the read moves every frame, never jumps at a fill, the same each run', () => {
  const run = () => {
    const W = createWindTex({ field: field() }), G = gpu(W), vals = [], ws = [];
    for (let f = 0; f <= 3 * EVERY_STEPS; f++) {
      const t = 100 + f * DT;
      W.update(t, 0, 0); G.upload();
      vals.push(G.read(t, 128, 128)[0]); ws.push(W.blend(t).w);
    }
    return { vals, ws, fills: W.fills };
  };
  const a = run(), b = run();
  assert.equal(a.fills, 4, 'the first frame, then the cadence');
  assert.deepEqual(b.vals, a.vals, 'deterministic');
  // after the second fill the weight climbs from 0 to 1 over the cadence, a step a frame
  assert.equal(a.ws[EVERY_STEPS], 0); assert.ok(Math.abs(a.ws[EVERY_STEPS + 15] - 0.5) < 1e-6); assert.ok(a.ws[2 * EVERY_STEPS - 1] > 0.96);
  // the read's frame-to-frame change: at a fill no larger than the steady drift between fills (it was the whole fill's step)
  const d = a.vals.slice(EVERY_STEPS + 1).map((v, i) => Math.abs(v - a.vals[EVERY_STEPS + i]));
  const steady = Math.max(...d.filter((_, i) => (i + 1) % EVERY_STEPS !== 0));
  const atFill = Math.max(...d.filter((_, i) => (i + 1) % EVERY_STEPS === 0));
  assert.ok(steady > 0, 'the gusts drift between fills');
  assert.ok(atFill <= steady * 1.5 + 1e-3, `at a fill ${atFill.toFixed(4)} vs between ${steady.toFixed(4)} m/s a frame`);
});

test('a cut (the first fill, a centre two snaps away) switches at once; a one-snap move waits for the cadence and is offset', () => {
  const W = createWindTex({ field: field() });
  W.update(100, 0, 0);
  assert.equal(W.blend(100).w, 1, 'the first fill alone');
  W.update(100 + DT, 300, 0);   // the eye past 256 m: the snapped centre moved one snap
  assert.equal(W.fills, 1, 'a one-snap move waits for the cadence');
  for (let f = 2; f <= EVERY_STEPS; f++) W.update(100 + f * DT, 300, 0);
  assert.equal(W.fills, 2); assert.deepEqual([...W.centre], [SNAP_M, 0]);
  const b = W.blend(100 + EVERY_STEPS * DT);
  assert.equal(b.w, 0); assert.deepEqual(b.off, [SNAP_M / 16, 0], 'the previous fill read 32 texels over');
  W.update(100 + (EVERY_STEPS + 1) * DT, 3000, 0);
  assert.equal(W.fills, 3, 'a far move fills at once'); assert.equal(W.blend(100 + (EVERY_STEPS + 1) * DT).w, 1, 'and is not faded from the old place');
  // a fill whose state is far in time from the last (the sim fast-forwarded: a settle, a race sailed on) is a cut too: no long fade
  const S = createWindTex({ field: field() });
  for (let f = 0; f < EVERY_STEPS; f++) S.update(100, 0, 0);
  S.update(100 + 2 * MAX_FADE_S, 0, 0);
  assert.equal(S.fills, 2); assert.equal(S.blend(100 + 2 * MAX_FADE_S).w, 1, 'a gap past MAX_FADE_S switches at once');
  // the reference blend: outside the previous fill the newest alone
  const prevAt = () => [0, 0, 0], curAt = () => [2, 4, 6];
  assert.deepEqual(blendTexel(prevAt, curAt, 10, 10, 0.25, [0, 0]), [0.5, 1, 1.5]);
  assert.deepEqual(blendTexel(prevAt, curAt, WIND_TEX - 10, 10, 0.25, [32, 0]), [2, 4, 6]);
});

test('a live page: the worker\'s result waits for the fade to finish (a late one holds, never jumps); a clock gone back ends it', () => {
  const posts = [];
  const fake = { postMessage: (m) => posts.push(m), terminate() {} };
  const W = createWindTex({ field: field(), live: true, makeWorker: () => fake });
  const reply = (cx = 0) => fake.onmessage({ data: { key: 1, cx, cz: 0, wind: new Uint16Array(WIND_TEX * WIND_TEX * 2), mean: new Uint16Array(WIND_TEX * WIND_TEX) } });
  W.update(100, 0, 0); reply(); W.update(100.2, 0, 0);
  assert.equal(W.fills, 1, 'the first result at once');
  reply(); W.update(100.4, 0, 0);   // its state is of t = 100.2: a 0.2 s segment from 100.4
  assert.equal(W.fills, 2); assert.ok(Math.abs(W.blend(100.5).w - 0.5) < 1e-9);
  reply(); W.update(100.5, 0, 0);
  assert.equal(W.fills, 2, 'held until the fade is done');
  W.update(100.6, 0, 0);
  assert.equal(W.fills, 3, 'taken once it is');
  W.update(50, 0, 0); assert.equal(W.blend(50).w, 1, 'a restart: the fade is over');
  assert.ok(posts.some((m) => m.type === 'return'), 'the buffers go back to the worker');
});

test('the blend WGSL passes the Safari lint', () => {
  assert.deepEqual(lintWgsl(WIND_BLEND_WGSL, 'wind-blend'), []);
});
