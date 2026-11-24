// The Safari WGSL lint (v2/engine/wgsl-lint.js): each rule on samples it must catch and samples it must leave alone. The
// scan over every module the real page builds is v2/tests/pages/safariWgsl.page.mjs (it needs the GPU).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintWgsl, fold } from '../engine/wgsl-lint.js';

const rules = (code) => lintWgsl(code, 't').map((h) => `${h.rule}:${h.kind}`);

test('the folder: literals, consts, arithmetic, f32(), splats; unknowns are null', () => {
  assert.deepEqual(fold('0.3 * 2.0 + 1'), { v: 1.6, kind: 'const' });
  assert.equal(fold('-(1.0 - 0.25)').v, -0.75);
  assert.equal(fold('f32(3) / 2.0').v, 1.5);
  assert.equal(fold('vec3f(0.5)').v, 0.5);
  assert.equal(fold('1e-3f').v, 0.001);
  assert.equal(fold('x * 2.0'), null);
  assert.equal(fold('vec3f(0.1, 0.2, 0.3)'), null);
  assert.equal(fold('A * 2.0', new Map([['A', { v: 3, kind: 'const' }]])).v, 6);
  assert.equal(fold('A', new Map([['A', { v: 3, kind: 'let' }]])).kind, 'let');
});

test('smoothstep with reversed literal edges is caught (Cold Smoke\'s iPhone black screen)', () => {
  assert.deepEqual(rules('fn f(x: f32) -> f32 { return smoothstep(0.8, 0.2, x); }'), ['smoothstep-reversed:const']);
  assert.deepEqual(rules('fn f(x: f32) -> f32 { return smoothstep(-0.1, -0.4, x); }'), ['smoothstep-reversed:const']);
  assert.deepEqual(rules('fn f(x: vec3f) -> vec3f { return smoothstep(vec3f(1.0), vec3f(0.0), x); }'), ['smoothstep-reversed:const']);
});

test('reversed edges through module consts and lets are caught; equal edges too', () => {
  assert.deepEqual(rules('const HI = 0.9;\nconst LO = 0.1;\nfn f(x: f32) -> f32 { return smoothstep(HI, LO * 2.0, x); }'), ['smoothstep-reversed:const']);
  assert.deepEqual(rules('fn f(x: f32) -> f32 { let a = 5.0; return smoothstep(a, 1.0, x); }'), ['smoothstep-reversed:let']);
  assert.deepEqual(rules('fn f(x: f32) -> f32 { return smoothstep(0.5, 0.5, x); }'), ['smoothstep-equal:const']);
});

test('well-ordered or runtime edges pass; comments are ignored', () => {
  assert.deepEqual(rules('fn f(x: f32, y: f32) -> f32 { return smoothstep(0.2, 0.8, x) * smoothstep(y, 0.1, x); }'), []);
  assert.deepEqual(rules('// smoothstep(0.9, 0.1, x)\n/* smoothstep(1.0, 0.0, x) */ fn f(x: f32) -> f32 { return 1.0 - smoothstep(0.1, 0.9, x); }'), []);
  assert.deepEqual(rules('fn f(x: f32) -> f32 { return smoothstep(0.0, 1.0, clamp(x, 0.0, 1.0)); }'), []);
});

test('a name reused with different values is not trusted (a shadowing let in another function)', () => {
  assert.deepEqual(rules('fn a(x: f32) -> f32 { let k = 0.2; return smoothstep(k, 0.5, x); }\nfn b(x: f32) -> f32 { let k = 0.9; return smoothstep(0.1, k, x); }'), []);
});

test('clamp with reversed const bounds, f16 without enable, f32 overflow', () => {
  assert.deepEqual(rules('fn f(x: f32) -> f32 { return clamp(x, 1.0, 0.0); }'), ['clamp-reversed:const']);
  assert.deepEqual(rules('fn f(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }'), []);
  assert.deepEqual(rules('fn f() -> f32 { let h = 1.5h; return f32(h); }'), ['f16-without-enable:const']);
  assert.deepEqual(rules('enable f16;\nfn f() -> f32 { let h = 1.5h; return f32(h); }'), []);
  assert.deepEqual(rules('const BIG = 4e38;'), ['f32-overflow:const']);
  assert.deepEqual(rules('const OK = 3e38;'), []);
});

test('a hit names the module, the line and the fix', () => {
  const [h] = lintWgsl('const A = 1.0;\n\nfn f(x: f32) -> f32 {\n  return smoothstep(0.7, 0.3, x);\n}', 'water');
  assert.equal(h.label, 'water'); assert.equal(h.line, 4);
  assert.match(h.text, /smoothstep\(0\.7, 0\.3, x\)/);
  assert.match(h.detail, /1\.0 - smoothstep\(0\.3, 0\.7/);
});
