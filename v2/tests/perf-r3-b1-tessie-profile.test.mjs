// Refactor round 3, B1: Tessie's profile lookup reads cached number rows by index (no key string, no row arrays per call).
// The old lookup is kept here; radiusAt and heightAt must match it bit for bit over many d and L, interleaved (cache switches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radiusAt, heightAt, reachAt } from '../sim/tessie.js';

const PROFILE = [[0, 0], [0.03, 0.15], [0.12, 0.3], [0.3, 0.43], [0.55, 0.5], [0.8, 0.47], [1.15, 0.36], [1.6, 0.31], [2.6, 0.4],
  [4.0, 0.6], [6.0, 0.8], [9.5, 0.82], [-6.0, 0.6], [-2.6, 0.33], [-0.7, 0.13], [-0.0, 0.0]];
const HF = [[0, 0.84], [0.9, 0.9], [2.0, 1.0], [6.0, 0.92], [-3, 0.95]];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { if (!Number.isFinite(a)) return x >= a ? 1 : 0; const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ROWS = new Map();
function oldTable(tab, d, L) {
  const key = tab === PROFILE ? `p${L}` : `h${L}`;
  let rows = ROWS.get(key);
  if (!rows) { rows = tab.map((r) => [r[0] < 0 || Object.is(r[0], -0) ? L + r[0] : r[0], r[1]]).sort((a, b) => a[0] - b[0]); if (ROWS.size > 16) ROWS.clear(); ROWS.set(key, rows); }
  if (d <= rows[0][0]) return rows[0][1];
  for (let i = 0; i + 1 < rows.length; i++) { const [a, va] = rows[i], [b, vb] = rows[i + 1]; if (d <= b) { const t = smooth(0, 1, (d - a) / Math.max(1e-9, b - a)); return va + (vb - va) * t; } }
  return rows[rows.length - 1][1];
}
const oldRadius = (d, L) => oldTable(PROFILE, d, L);
const oldHeight = (d, L) => oldTable(PROFILE, d, L) * oldTable(HF, d, L) + (d > 2.3 && d < L - 1.4 ? 0.15 : 0);

test('B1: radiusAt and heightAt equal the old lookup bit for bit', () => {
  const Ls = [16, 14.5, 18, 12, 16, 20.25, 9.7, 16, 13, 15, 17, 19, 11, 16.000001];
  let n = 0;
  for (let k = 0; k < 3; k++) for (const L of Ls) for (let d = -1.5; d <= L + 1.5; d += 0.0137) {
    assert.ok(Object.is(radiusAt(d, L), oldRadius(d, L)), `radius d=${d} L=${L}`);
    assert.ok(Object.is(heightAt(d, L), oldHeight(d, L)), `height d=${d} L=${L}`);
    n++;
  }
  // the rows' own knots, the ends and their neighbours
  for (const L of [16, 12.5]) for (const r of [...PROFILE, ...HF]) for (const e of [-1e-9, 0, 1e-9]) {
    const d = (r[0] < 0 || Object.is(r[0], -0) ? L + r[0] : r[0]) + e;
    assert.ok(Object.is(radiusAt(d, L), oldRadius(d, L)) && Object.is(heightAt(d, L), oldHeight(d, L)), `knot d=${d} L=${L}`);
  }
  assert.ok(n > 10000);
  assert.ok(Number.isFinite(reachAt(5, 16)));
});
