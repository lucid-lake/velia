// Canvas sizing (v2/engine/canvas.js backingSize) and the matrices (v2/engine/math.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { backingSize } from '../engine/canvas.js';
import { mat4, perspective, lookDir, multiply, invert, forwardOf } from '../engine/math.js';

test('backing size: DPR capped, scale applied, then the pixel budget', () => {
  assert.deepEqual(backingSize({ cssW: 1280, cssH: 720, dpr: 1 }), [1280, 720]);
  assert.deepEqual(backingSize({ cssW: 1280, cssH: 720, dpr: 3, dprCap: 2, maxPx: 1e7 }), [2560, 1440]);
  assert.deepEqual(backingSize({ cssW: 1280, cssH: 720, dpr: 2, scale: 0.6 }), [1536, 864]);
  const [w, h] = backingSize({ cssW: 1728, cssH: 1117, dpr: 2, maxPx: 3.4e6 });   // a 16" MacBook at DPR 2 = 7.7 Mpx
  assert.ok(w * h <= 3.4e6 + 2000 && w * h > 3.3e6, `${w}×${h}`);
  assert.ok(Math.abs(w / h - 1728 / 1117) < 0.01, 'the aspect is kept');
  assert.deepEqual(backingSize({ cssW: 0, cssH: 0, dpr: 2 }), [1, 1]);
});

const mulVec = (m, v) => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);

test('perspective maps near to z = 0 and far to z = 1 (WebGPU clip space)', () => {
  const p = perspective(mat4(), Math.PI / 3, 16 / 9, 0.5, 1000);
  const n = mulVec(p, [0, 0, -0.5, 1]), f = mulVec(p, [0, 0, -1000, 1]);
  assert.ok(Math.abs(n[2] / n[3]) < 1e-6); assert.ok(Math.abs(f[2] / f[3] - 1) < 1e-6);
});

test('lookDir: a point ahead lands on −z in view space; invert(viewProj) unprojects the centre ray to the forward', () => {
  const eye = [0, 2.5, 0], fwd = forwardOf([0, 0, 0], 90, 0);   // yaw 90 = east
  assert.ok(Math.abs(fwd[0] - 1) < 1e-9 && Math.abs(fwd[2]) < 1e-9);
  const v = lookDir(mat4(), eye, fwd);
  const ahead = mulVec(v, [10, 2.5, 0, 1]);
  assert.ok(Math.abs(ahead[0]) < 1e-6 && Math.abs(ahead[1]) < 1e-6 && Math.abs(ahead[2] + 10) < 1e-6);
  const p = perspective(mat4(), Math.PI / 3, 16 / 9, 0.5, 1000);
  const vp = multiply(mat4(), p, v), inv = invert(mat4(), vp);
  const a = mulVec(inv, [0, 0, 0, 1]), b = mulVec(inv, [0, 0, 1, 1]);
  const d = [b[0] / b[3] - a[0] / a[3], b[1] / b[3] - a[1] / a[3], b[2] / b[3] - a[2] / a[3]];
  const l = Math.hypot(...d);
  assert.ok(Math.abs(d[0] / l - 1) < 1e-4 && Math.abs(d[1] / l) < 1e-4 && Math.abs(d[2] / l) < 1e-4, `centre ray ${d.map((x) => (x / l).toFixed(4))}`);
  const id = multiply(mat4(), vp, inv);
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(id[i] - (i % 5 === 0 ? 1 : 0)) < 1e-4, `identity at ${i}`);
});

test('forwardOf: yaw 0 is north (−z), pitch raises y; a singular matrix has no inverse', () => {
  const n = forwardOf([0, 0, 0], 0, 0); assert.ok(Math.abs(n[2] + 1) < 1e-9 && Math.abs(n[0]) < 1e-9);
  const u = forwardOf([0, 0, 0], 0, 30); assert.ok(Math.abs(u[1] - 0.5) < 1e-9);
  assert.equal(invert(mat4(), new Float32Array(16)), null);
});
