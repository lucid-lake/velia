// Refactor round 3, B3: the rig's bearings (the wires' points the sails are held off) go into a scratch list, no allocation
// per sail point. The sails' points must equal the old code's bit for bit: a hash of every coordinate over many states, the
// golden recorded from main (e131b036) before the change (`node tests/perf-r3-b3-rig-bearings.test.mjs --print`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainPoint, jibPoint, outsideMain, insideMain, sailParams, stubState } from '../src/boat/rig.js';

// FNV-1a over the float64 bits of every number, in order
function sweep() {
  const f64 = new Float64Array(1), u8 = new Uint8Array(f64.buffer);
  let h = 0x811c9dc5, n = 0;
  const eat = (x) => { f64[0] = x; for (let i = 0; i < 8; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193) >>> 0; } n++; };
  const out = [0, 0, 0];
  for (const awaDeg of [-170, -120, -90, -60, -40, -25, 20, 35, 50, 75, 100, 135, 160, 180])
    for (const [main, jib, reef, backed, flatten] of [[0.2, 0.18, 0, false, 0], [0.05, 0.05, 1, false, 0.5], [0.9, 0.8, 0, true, 0], [0.4, 0.3, 2, false, 1]]) {
      const s = sailParams(stubState({ awaDeg, awsMs: 7, main, jib, flatten, reef, backed }));
      for (let v = 0; v <= 1.0001; v += 1 / 23) for (let u = 0; u <= 1.0001; u += 1 / 11) {
        for (const t of [0, 1.3]) {
          mainPoint(u, v, s.main, t, out); eat(out[0]); eat(out[1]); eat(out[2]);
          jibPoint(u, v, s.jib, t, out); eat(out[0]); eat(out[1]); eat(out[2]);
        }
      }
      for (let y = 0.5; y < 9; y += 0.37) for (const x of [-0.3, -0.05, 0.05, 0.3]) {
        const q = outsideMain([x, y, 0.4], s.main); eat(q[0]); eat(q[1]); eat(q[2]);
        const r = insideMain([x, y, 0.2], s.main); eat(r[0]); eat(r[1]); eat(r[2]);
      }
    }
  return { hash: h.toString(16), n };
}

if (process.argv.includes('--print')) console.log(JSON.stringify(sweep()));
else test('B3: the sails held off the rigging equal the old bearings bit for bit (golden from main)', () => {
  assert.deepEqual(sweep(), GOLDEN);
});
var GOLDEN = { hash: 'bef0ab93', n: 224448 };
