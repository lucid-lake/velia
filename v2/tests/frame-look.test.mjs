// fix(v2) frame look (2026-11-14): v1's camera on v2's frame (render/grade.js). The port is held to v1's own functions:
// v1's grade (src/core/grade.js, importable in node), its LUT bytes, its strengths by the sun; AgX against three.js r184's
// published curve values; the sky match's numbers; the frame's look row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeSrgb, gradeLutData, gradeStrength, skyStrength, GRADE, SKY, SKY_MATCH, agx, AGX_WGSL, SKY_CURVE_WGSL, toSrgb } from '../render/grade.js';
import * as V1 from '../../classic/src/core/grade.js';
import { FRAME_FIELDS } from '../engine/uniforms.js';
import { parseV2Flags } from '../engine/flags.js';

test('the grade is v1\'s: the same numbers, the same colours, the same LUT bytes, the same strengths by the sun', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(GRADE)), JSON.parse(JSON.stringify(V1.GRADE)));
  assert.deepEqual({ ...SKY, dayDeg: [...SKY.dayDeg] }, { ...V1.SKY, dayDeg: [...V1.SKY.dayDeg] });
  for (let r = 0; r <= 1; r += 0.125) for (let g = 0; g <= 1; g += 0.125) for (let b = 0; b <= 1; b += 0.125) {
    const a = gradeSrgb([r, g, b]), w = V1.gradeSrgb([r, g, b]);
    assert.ok(a.every((v, i) => Math.abs(v - w[i]) < 1e-12), `${r},${g},${b}`);
  }
  assert.deepEqual(gradeLutData(), V1.gradeLutData());
  for (let e = -10; e <= 20; e += 0.5) { assert.ok(Math.abs(gradeStrength(e) - V1.gradeStrength(e)) < 1e-12); assert.ok(Math.abs(skyStrength(e) - V1.skyStrength(e)) < 1e-12); }
});

test('AgX is three.js r184\'s: mid grey, the toe and the shoulder, neutral stays neutral, monotone', () => {
  // three's agxToneMapping: 0.18 → 0.2140 display-linear (sRGB 128), 0 → 0 after the clamp, 16 → 0.9 and up
  const grey = agx([0.18, 0.18, 0.18]);
  assert.ok(Math.abs(toSrgb(grey[0]) * 255 - 128) < 1, `mid grey ${toSrgb(grey[0]) * 255}`);
  assert.ok(grey.every((v) => Math.abs(v - grey[0]) < 2e-3), 'a grey stays grey');
  assert.ok(agx([0, 0, 0])[0] < 1e-3 && agx([16, 16, 16])[0] > 0.85);
  let prev = -1;
  for (let x = 1e-4; x < 64; x *= 1.2) { const y = agx([x, x, x])[1]; assert.ok(y >= prev - 1e-9, `monotone at ${x}`); prev = y; }
  assert.match(AGX_WGSL, /fn agx\(x0: vec3f\) -> vec3f/);
});

test('the sky match: v1\'s polariser over it is the fitted whole-sky curve (lum 1.62, sat 1.2); the frame carries the look row', () => {
  assert.ok(Math.abs(SKY_MATCH.lum * SKY.lum - 1.62) < 1e-12 && Math.abs(SKY_MATCH.sat * SKY.sat - 1.2) < 1e-12);
  assert.match(SKY_CURVE_WGSL, /fn skyMatch/); assert.match(SKY_CURVE_WGSL, /fn polarSky/);
  assert.deepEqual(FRAME_FIELDS.find(([n]) => n === 'look'), ['look', 'vec4f', 4]);   // the spume's and the wind's rows follow it
  assert.equal(parseV2Flags('?look=v2').look, 'v2'); assert.equal(parseV2Flags('').look, null);
  assert.equal(parseV2Flags('?grade=0').grade, '0');
});
