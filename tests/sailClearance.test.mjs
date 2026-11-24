// The cloth never passes through the rigging (owner, 2026-11-12: "from this angle, the lines insert through the sail").
// Eased to the shrouds, the main bears on them from aft; hard in, the jib's leech bears on the forward lower from
// inside; the halyards and the sheets lie outside the cloth. Plain JS: segment-triangle tests on the sail surfaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jibPoint, mainPoint, sailParams, LUFF_Z } from '../src/boat/rig.js';
import { lineSet } from '../classic/src/boat/lines.js';
import { SPARS, solveRig, buildSpars } from '../src/boat/spars.js';

const DEG = Math.PI / 180;
const rig = solveRig(SPARS);
const STANDING = buildSpars(rig).wires.filter((w) => w.kind === 'steel' && w.name !== 'forestay').map((w) => ['wire ' + w.name, w.a, w.b]);
for (const side of [1, -1]) SPARS.spreaders.forEach((sp, i) => {
  const tip = rig.points.tips[i];
  STANDING.push([`spreader ${i} ${side > 0 ? 'S' : 'P'}`, [side * 0.05, sp.y, 0], [side * tip[0], tip[1], tip[2]]]);
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function segHitsTri(p, q, a, b, c) {
  const e1 = sub(b, a), e2 = sub(c, a), d = sub(q, p), h = cross(d, e2), det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return false;
  const f = 1 / det, s = sub(p, a), u = f * dot(s, h);
  if (u < 0 || u > 1) return false;
  const k = cross(s, e1), v = f * dot(d, k);
  if (v < 0 || u + v > 1) return false;
  const t = f * dot(e2, k);
  return t >= 0 && t <= 1;
}
// the cloth as triangles, leaving out the edges a line legitimately meets: the luff (mast track, stay), the main's foot
// on the boom, the jib's clew (the sheets start there)
function cloth(fn, s, nu, nv, kind) {
  const P = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) P.push(fn(i / nu, j / nv, s, null, [0, 0, 0]));
  const T = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = i / nu, v = j / nv;
    if (u < 0.03 || (kind === 'main' && v < 0.03) || (kind === 'jib' && u > 0.95 && v < 0.03)) continue;
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    T.push([P[a], P[b], P[d]], [P[a], P[d], P[c]]);
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return { T, lo, hi };
}
function crossings(sail, segs) {
  const out = new Set();
  for (const [name, p, q] of segs) {
    if ([0, 1, 2].some((k) => Math.max(p[k], q[k]) < sail.lo[k] || Math.min(p[k], q[k]) > sail.hi[k])) continue;
    for (const [a, b, c] of sail.T) if (segHitsTri(p, q, a, b, c)) { out.add(name); break; }
  }
  return [...out];
}
const segsOf = (lines) => lines.flatMap((l) => l.points.slice(1).map((q, k) => [l.name, l.points[k], q]));

test('the standing rigging never passes through the cloth: the main eased onto the shrouds, the jib hard in, both tacks', () => {
  const bad = [];
  for (const sg of [1, -1]) for (const [b, j] of [[72, 5], [66, 8], [60, 24], [40, 32], [20, 13], [4, 0]]) {
    const p = sailParams({ boomAngle: sg * b * DEG, jibAngle: sg * j * DEG });
    for (const [kind, sail] of [['main', cloth(mainPoint, p.main, 40, 64, 'main')], ['jib', cloth(jibPoint, p.jib, 32, 56, 'jib')]])
      for (const n of crossings(sail, STANDING)) bad.push(`${kind} × ${n} (boom ${sg * b}°, jib ${sg * j}°)`);
  }
  assert.deepEqual(bad, []);
});

test('the sheets and the halyards stay outside the cloth (the lazy jacks: the last test)', () => {
  const bad = [];
  for (const sg of [1, -1]) for (const [b, j] of [[72, 24], [50, 13], [40, 13], [12, 5]]) {
    const st = { boomAngle: sg * b * DEG, jibAngle: sg * j * DEG };
    const p = sailParams(st);
    const segs = segsOf(lineSet(st, 0).filter((l) => /sheet|halyard/.test(l.name)));
    for (const [kind, sail] of [['main', cloth(mainPoint, p.main, 40, 64, 'main')], ['jib', cloth(jibPoint, p.jib, 32, 56, 'jib')]])
      for (const n of crossings(sail, segs)) bad.push(`${kind} × ${n} (boom ${sg * b}°, jib ${sg * j}°)`);
  }
  assert.deepEqual(bad, []);
});

test('away from the shrouds the cloth keeps its shape: the jib eased past the chainplates stays outside them', () => {
  // eased past the rail the jib's clew is outboard of the forward lower: the cloth keeps that side (not pulled in)
  const p = sailParams({ jibAngle: 32 * DEG, boomAngle: 40 * DEG });
  const clew = jibPoint(1, 0, p.jib, null);
  assert.ok(clew[0] > 1.5, `clew x ${clew[0].toFixed(2)} m`);
  const mid = jibPoint(0.5, 0.3, p.jib, null);
  assert.ok(mid[0] > 0.6, `mid-sail x ${mid[0].toFixed(2)} m`);
});

// #43 (BACKLOG-v2): the leeward lazy jacks left the mast outside the cloth and ran into it 0.13–0.2 m aft of the luff
// (the belly leaves the luff steeper than the jack); held inside the belly, a jack meets the cloth only at the luff
// groove, inside the mast's own width (≤ 0.08 m from the groove), and never again along its run
function jackHits(sail, segs) {
  const out = [];
  for (const [name, p, q] of segs) for (const [a, b, c] of sail.T) {
    if (!segHitsTri(p, q, a, b, c)) continue;
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    out.push({ name, aft: Math.hypot(m[0], m[2] - LUFF_Z), y: m[1] });
  }
  return out;
}
test('the lazy jacks meet the main only at the mast: no crossing past 0.08 m from the luff, both tacks, close-hauled to run', () => {
  const bad = [];
  for (const sg of [1, -1]) for (const b of [4, 12, 20, 30, 40, 50, 60, 72]) {
    const st = { boomAngle: sg * b * DEG, jibAngle: sg * 10 * DEG };
    const main = cloth(mainPoint, sailParams(st).main, 60, 80, 'none');
    for (const h of jackHits(main, segsOf(lineSet(st, 0).filter((l) => /lazyjack/.test(l.name)))))
      if (h.aft > 0.08) bad.push(`${h.name} at ${h.aft.toFixed(2)} m aft, y ${h.y.toFixed(2)} (boom ${sg * b}°)`);
  }
  assert.deepEqual(bad, []);
});
