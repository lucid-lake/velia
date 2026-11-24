// The jib's cloth is one smooth surface (owner, 2026-11-16: "I often see the jib split into two halves"): across its width and up
// its height no two neighbouring segments turn by more than 40° (a soft crease where the cloth bears on a wire; the fault
// was 75–135° folds), and no neighbouring normals flip, in every state it is drawn in: hard in (the race crew's ≈ 13°, R held
// to 0°), close-hauled, eased, luffing, backed, on both tacks and through a tack. The causes, in src/boat/rig.js bear(): a
// shroud's hold cut off in one row where the wire ended (the lowers at the mast) or fell just past the section's reach, and
// a head point 2 cm off the luff left free beside one turned ≈ 80°.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sailParams, jibPoint } from '../../src/boat/rig.js';
import { sailGrid, fillSail, SAIL_GRIDS } from '../render/boat/mesh.js';
import { drawnSail } from '../render/boat/drawnTrim.js';

const DEG = Math.PI / 180;
function worst(desc) {
  const g = sailGrid(...SAIL_GRIDS.jib); fillSail(g, jibPoint, desc);
  const { nu, nv, position: P, normal: N } = g, W = nu + 1, at = (i, j) => { const k = 3 * (j * W + i); return [P[k], P[k + 1], P[k + 2]]; };
  const turn = (p0, p1, p2) => {
    const a = p1.map((x, c) => x - p0[c]), b = p2.map((x, c) => x - p1[c]), la = Math.hypot(...a), lb = Math.hypot(...b);
    return la < 1e-4 || lb < 1e-4 ? 0 : Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / la / lb))) / DEG;
  };
  let deg = 0, where = null, flips = 0;
  for (let j = 1; j < nv; j++) for (let i = 1; i < nu; i++) {
    const du = turn(at(i - 1, j), at(i, j), at(i + 1, j)), dv = turn(at(i, j - 1), at(i, j), at(i, j + 1));
    if (Math.max(du, dv) > deg) { deg = Math.max(du, dv); where = [i / nu, j / nv].map((x) => +x.toFixed(2)); }
  }
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) for (const [di, dj] of [[1, 0], [0, 1]]) {
    if (i + di > nu || j + dj > nv) continue;
    const k = 3 * (j * W + i), q = 3 * ((j + dj) * W + i + di);
    if (N[k] * N[q] + N[k + 1] * N[q + 1] + N[k + 2] * N[q + 2] < 0) flips++;
  }
  return { deg, where, flips };
}

test('the jib is one smooth cloth in every drawn state: no fold over 40°, no flipped normals', () => {
  const bad = [];
  for (const backed of [false, true]) for (const fill of [1, 0.5, 0]) for (let a = -44; a <= 44; a += 2) for (const lead of [0, 1, -1]) {
    const st = { boomAngle: -Math.sign(a || 1) * 0.15, jibAngle: a * DEG, mainFill: 1, jibFill: fill, mainDraft: 1, jibDraft: 1, jibBacked: backed, jibLead: lead, jibTwistX: 5 * lead };
    const w = worst(drawnSail(sailParams(st), null).jib);
    if (w.deg > 40 || w.flips) bad.push(`${backed ? 'backed ' : ''}fill ${fill} jib ${a}° lead ${lead}: ${w.deg.toFixed(0)}° at ${w.where} flips ${w.flips}`);
  }
  assert.deepEqual(bad, []);
});

test('the race crew\'s hard-in jib (≈ 13°) and R held to the stop (0°): smooth on both tacks', () => {
  for (const a of [-13, 13, -3, 3, 0]) {
    const w = worst(sailParams({ boomAngle: -Math.sign(a || 1) * 0.15, jibAngle: a * DEG, mainFill: 1, jibFill: 1, mainDraft: 1, jibDraft: 1 }).jib);
    assert.ok(w.deg < 40 && !w.flips, `jib ${a}°: ${w.deg.toFixed(1)}° at ${w.where}, flips ${w.flips}`);
  }
});
