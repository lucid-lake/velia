// The sea state (v2/sim/spectrum.js SEA_STATES, ?sea=): v1's fetch-limited lake sea kept as the row `v1` (the pure default, so
// every v1 parity check holds), and the default `big`: a swell on the open lake and longer, higher wind seas, open lake and bay.
// The numbers are the composed table's at the boat (spectrum.js composeSea over v1's place weights), Hs = 4σ of the
// displacement tiles, Tp the energy peak of the table's 1-D spectrum; water.md § The sea state carries the full table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEA_STATES, SEA_DEFAULT, seaState, swellHs, seaTables, seaWeights, composeSea, significantHeight, seaKey, LENGTHS, CPU_CASCADES, N } from '../sim/spectrum.js';
import { shoreParams } from '../sim/shoreField.js';
import { V2_ROWS } from '../engine/flags.js';

const G = 9.81;
function tpOf(h0) {
  const bins = new Float64Array(400), dw = 0.02;
  for (let c = 0; c < CPU_CASCADES; c++) {
    const dk = 2 * Math.PI / LENGTHS[c];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = ((c * N + y) * N + x) * 4, e = h0[o] ** 2 + h0[o + 1] ** 2 + h0[o + 2] ** 2 + h0[o + 3] ** 2;
      if (!e) continue;
      const b = Math.floor(Math.sqrt(G * Math.hypot((x - N / 2) * dk, (y - N / 2) * dk)) / dw);
      if (b < bins.length) bins[b] += e;
    }
  }
  let best = 0, bw = 0;
  for (let i = 3; i < bins.length - 3; i++) { let s = 0; for (let j = -3; j <= 3; j++) s += bins[i + j]; if (s > best) { best = s; bw = (i + 0.5) * dw; } }
  return 2 * Math.PI / bw;
}
const at = (sea, U, fetchM) => { const T = seaTables({ speedMs: U, travelRad: 0.4, sea }), h = composeSea(T, seaWeights({ U, fetchM })); return { hs: significantHeight(h, LENGTHS, CPU_CASCADES), tp: tpOf(h) }; };

test('the rows: v1 is v1 (no swell, its 25 / 6 km and gains); big is the default; an unknown id falls back to the default', () => {
  assert.deepEqual({ ...SEA_STATES.v1 }, { id: 'v1', lakeShapeKm: 25, bayShapeKm: 6, lakeHs: 1, bayHs: 1, swell: null, baySwell: null });
  assert.equal(SEA_DEFAULT, 'big');
  assert.equal(seaState('nonsense').id, 'big'); assert.equal(seaState(undefined).id, 'big'); assert.equal(seaState('v1').id, 'v1');
  assert.ok(V2_ROWS.some((r) => r.name === 'sea' || r[0] === 'sea' || r.key === 'sea'), 'a flag row for ?sea=');
});

test('v1\'s tables are unchanged: the pure default is v1, its key carries no state, the bytes match an explicit v1', () => {
  const a = seaTables({ speedMs: 6, travelRad: 1.1 }), b = seaTables({ speedMs: 6, travelRad: 1.1, sea: 'v1' });
  assert.equal(a.key, '6.0|1.10'); assert.equal(a.key, seaKey(6, 1.1));
  assert.equal(a.gL, b.gL); assert.equal(a.gB, b.gB);
  for (let i = 0; i < a.hL.length; i += 997) { assert.equal(a.hL[i], b.hL[i]); assert.equal(a.hB[i], b.hB[i]); }
  assert.equal(seaTables({ speedMs: 6, travelRad: 1.1, sea: 'big' }).key, '6.0|1.10|big');
});

test('the swell: present in a light wind, growing with it, capped', () => {
  const sw = SEA_STATES.big.swell;
  assert.equal(swellHs(0, sw), sw.lo); assert.equal(swellHs(30, sw), sw.hi);
  for (let U = 1; U < 14; U++) assert.ok(swellHs(U + 1, sw) >= swellHs(U, sw));
  assert.equal(swellHs(7, null), 0);
});

test('bigger and longer: open lake Hs ≥ 1.4 × v1 and Tp ≥ 1.3 × v1 and ≥ 3.9 s at 5–9 m/s; the bay Hs ≥ 1.4 × v1 and Tp ≥ 1.3 × v1', () => {
  for (const U of [5, 7, 9]) {
    const o1 = at('v1', U, 20000), o2 = at('big', U, 20000), b1 = at('v1', U, 1500), b2 = at('big', U, 1500);
    assert.ok(o2.hs >= 1.4 * o1.hs, `open lake ${U} m/s: Hs ${o1.hs.toFixed(2)} → ${o2.hs.toFixed(2)} m`);
    assert.ok(o2.tp >= Math.max(3.9, 1.3 * o1.tp), `open lake ${U} m/s: Tp ${o1.tp.toFixed(2)} → ${o2.tp.toFixed(2)} s`);
    assert.ok(b2.hs >= 1.4 * b1.hs, `bay ${U} m/s: Hs ${b1.hs.toFixed(2)} → ${b2.hs.toFixed(2)} m`);
    assert.ok(b2.tp >= 1.3 * b1.tp, `bay ${U} m/s: Tp ${b1.tp.toFixed(2)} → ${b2.tp.toFixed(2)} s`);
    assert.ok(o2.hs < 2.2 && b2.hs < 1.6, 'not a storm sea at a sailing wind');
  }
});

test('the shore\'s trains take the bay sea\'s period: v1 at 6 km, the big sea at its 20 km shape', () => {
  const a = shoreParams({ U: 7, travelRad: 0 }), b = shoreParams({ U: 7, travelRad: 0, shapeKm: SEA_STATES.big.bayShapeKm });
  assert.ok(b.T > 1.3 * a.T, `${a.T.toFixed(2)} → ${b.T.toFixed(2)} s`);
});
