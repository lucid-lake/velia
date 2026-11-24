// The July 4th barges as meshes (v2/render/bargeMesh.js; owner, 2026-11-18, round 2): real size, every material present, finite,
// the two levels in budget, the pushboat at the stern and the patrol boat small.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBarge, buildPatrol, buildPropMeshes, HULL, TUG, SLOT, VF } from '../render/bargeMesh.js';

const bbox = (a) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.length; i += VF) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]); } return { lo, hi }; };
const slots = (a) => { const s = new Set(); for (let i = 6; i < a.length; i += VF) s.add(a[i]); return s; };

test('the high barge: real proportions, the pushboat astern, every material, finite normals', () => {
  const m = buildBarge({ lod: 'high' }), { lo, hi } = bbox(m);
  assert.ok(Math.abs(hi[0] - HULL.length / 2) < 0.3, `bow end at +${hi[0].toFixed(2)} m`);
  assert.ok(Math.abs(lo[0] - (TUG.x - TUG.length / 2)) < 0.5, `pushboat's stern at ${lo[0].toFixed(2)} m`);
  assert.ok(hi[2] < HULL.beam / 2 + 0.35 && hi[2] > HULL.beam / 2, `beam with the fenders ${(2 * hi[2]).toFixed(2)} m`);
  assert.ok(lo[1] <= -(HULL.depth - HULL.freeboard) + 1e-6 && lo[1] > -1.3, `the bottoms 1.1–1.25 m under the waterline (${lo[1].toFixed(2)})`);
  for (const k of ['hull', 'deck', 'sand', 'wood', 'tube', 'mouth', 'container', 'galv', 'rubber', 'ring', 'white', 'glass', 'tugHull', 'black']) assert.ok(slots(m).has(SLOT[k]), k);
  for (let i = 0; i < m.length; i += VF) { const l = Math.hypot(m[i + 3], m[i + 4], m[i + 5]); assert.ok(Number.isFinite(m[i]) && l > 0.9 && l < 1.1, `vertex ${i / VF}`); }
});

test('the levels: the low barge a few hundred triangles with the same hull, the high under 35 k; the patrol boat small', () => {
  const R = buildPropMeshes().runs;
  assert.ok(R.bargeHigh.count / 3 < 35000, `high ${R.bargeHigh.count / 3}`);
  assert.ok(R.bargeLow.count / 3 < 1200, `low ${R.bargeLow.count / 3}`);
  assert.ok(!slots(buildBarge({ lod: 'low' })).has(SLOT.tube), 'no tubes in the low mesh (the shader draws their mouths)');
  const p = bbox(buildPatrol());
  assert.ok(Math.abs(p.hi[2] - p.lo[2] - 8.5) < 0.1 && p.hi[0] - p.lo[0] < 2.8, 'the 8.5 × 2.7 m patrol boat');
});
