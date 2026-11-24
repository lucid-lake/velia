// Refactor round 3, B2: the night sea's re-composition reuses its buffers, bayShares reads the cached table energies, and
// seaStats takes Hs and each tile's Σ h0² in one pass. Each must equal the old code (kept here) bit for bit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { N, LENGTHS, CPU_CASCADES, seaTables, seaWeights, composeSea, bayShares, seaStats, significantHeight, tileEnergies } from '../sim/spectrum.js';
import { tileEnergies as fieldEnergies } from '../sim/seaField.js';

const NN = N * N;
function oldBayShares(T, w) {
  const out = [0, 0, 0];
  for (let c = 0; c < CPU_CASCADES; c++) {
    let eL = 0, eB = 0;
    for (let i = c * NN * 4, e = i + NN * 4; i < e; i++) { eL += T.hL[i] * T.hL[i]; eB += T.hB[i] * T.hB[i]; }
    const l = eL * (w.lake[c] * T.gL) ** 2, b = eB * (w.bay * T.gB) ** 2;
    out[c] = l + b > 0 ? b / (l + b) : 0;
  }
  return out;
}
function oldCompose(T, w) {
  const out = new Float32Array(T.hL.length);
  for (let c = 0; c < LENGTHS.length; c++) {
    const a = w.lake[c] * T.gL, b = c < CPU_CASCADES ? w.bay * T.gB : 0, o0 = c * NN * 4, o1 = o0 + NN * 4;
    for (let o = o0; o < o1; o++) out[o] = a * T.hL[o] + b * T.hB[o];
  }
  return out;
}
const oldTiles = (h0) => { const t = []; for (let c = 0; c < CPU_CASCADES; c++) { let v = 0; for (let i = c * NN * 4, e = i + NN * 4; i < e; i++) v += h0[i] * h0[i]; t.push(4 * Math.sqrt(v)); } return t; };

test('B2: composeSea into a reused buffer, bayShares and seaStats equal the old code bit for bit', () => {
  const T = seaTables({ speedMs: 2, travelRad: 1.1 });
  let buf;
  const shares = [0, 0, 0], tiles = [0, 0, 0];
  for (const [U, fetchM, x, z] of [[2, 1000, 1200, -1050], [2.3, 25000, 5000, -5000], [1.7, 300, 409, -1839], [2, 6000, 0, 0], [12, 4000, 2300, -1400]]) {
    const w0 = seaWeights({ U, fetchM, x, z }), w = { lake: w0.lake.map((v) => v * 1.07), bay: w0.bay * 0.93 };
    const want = oldCompose(T, w);
    buf = composeSea(T, w, buf);
    assert.deepEqual(Buffer.from(buf.buffer), Buffer.from(want.buffer), `compose U=${U} F=${fetchM}`);
    const hs = seaStats(buf, tiles);
    assert.ok(Object.is(hs, significantHeight(want, LENGTHS, CPU_CASCADES)), `hs U=${U}`);
    const ot = oldTiles(want);
    for (let c = 0; c < CPU_CASCADES; c++) assert.ok(Object.is(4 * Math.sqrt(tiles[c]), ot[c]), `tile ${c} U=${U}`);
    const ob = oldBayShares(T, w);
    assert.equal(bayShares(T, w, shares), shares);
    for (let c = 0; c < CPU_CASCADES; c++) assert.ok(Object.is(shares[c], ob[c]), `share ${c} U=${U}`);
    assert.deepEqual(bayShares(T, w), ob);
  }
  assert.equal(fieldEnergies, tileEnergies);   // seaField's setRef reads the same cache
});
