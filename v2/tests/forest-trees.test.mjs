// T5: the forest's trees as meshes (v2/forest/trees.js), the input of the cards' bake (v2/render/forest.js): Cold
// Smoke's build in summer. The bake keeps the meshes' own normals (true, not bent to a ball) and no shade in a colour:
// the meshes carry a material, an ao and an open-sky share, never a lit colour; the light is the draw's.
// The GPU side of the bake (the atlas read back: no light baked, depth per texel) is v2/tests/pages/forestBake.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAll, buildTree, SPECIES, FL, KIND } from '../forest/trees.js';
import { SHAPES } from '../render/forest.js';

const M = buildAll(SHAPES);
const vtx = (m, i) => { const o = i * FL; return { p: [m.V[o], m.V[o + 1], m.V[o + 2]], n: [m.V[o + 3], m.V[o + 4], m.V[o + 5]], kind: m.V[o + 6], ao: m.V[o + 7], open: m.V[o + 8] }; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };

test('a tree a layer, in the same order as the cards\' shapes; deterministic (a second build is byte-identical)', () => {
  assert.equal(M.length, SHAPES.length);
  M.forEach((m, l) => assert.equal(m.id, SHAPES[l].id));
  const again = buildTree(3, SHAPES[3]);
  assert.deepEqual(Buffer.from(again.V.buffer), Buffer.from(M[3].V.buffer));
  assert.deepEqual(Buffer.from(again.I.buffer), Buffer.from(M[3].I.buffer));
});

test('Cold Smoke\'s build: about ninety boughs on a fir, tiers with sky between, a visible trunk; no snow kind; a snag has no needles', () => {
  const by = Object.fromEntries(M.map((m) => [m.id, m]));
  assert.ok(by.redfir.boughs >= 90 && by.redfir.boughs <= 140, `red fir ${by.redfir.boughs} boughs`);
  assert.ok(by.whitefir.boughs >= 80, `white fir ${by.whitefir.boughs}`);
  assert.ok(by.pine.boughs >= 35, `Jeffrey pine ${by.pine.boughs}`);   // T1: an open crown (about 30 % of its boughs missing)
  for (const m of M) {
    const kinds = new Set(); for (let i = 0; i < m.nv; i++) kinds.add(vtx(m, i).kind);
    for (const k of kinds) assert.ok(Object.values(KIND).includes(k), `${m.id}: kind ${k}`);
    if (m.id === 'snag') assert.deepEqual([...kinds], [KIND.bark], 'a snag is bark only');
    else if (m.id === 'shrub') assert.ok(kinds.has(KIND.leaf));
    else assert.ok(kinds.has(KIND.bark) && (kinds.has(KIND.spray) || kinds.has(KIND.tuft)), `${m.id}: a stem and foliage`);
  }
  // the pines' crowns start high on a bare stem (v1's crown base), the firs' near the ground
  const lowestFoliage = (m) => { let y = Infinity; for (let i = 0; i < m.nv; i++) { const v = vtx(m, i); if (v.kind !== KIND.bark) y = Math.min(y, v.p[1]); } return y; };
  assert.ok(lowestFoliage(by.pine) > 0.3 && lowestFoliage(by.lodgepole) > 0.35, 'pines: a clear lower trunk');
  assert.ok(lowestFoliage(by.redfir) < 0.1, 'red fir: skirts to the ground');
  assert.ok(lowestFoliage(by['pine-old']) > lowestFoliage(by['pine-young']), 'the old pine: a longer clear trunk than the young one');
});

test('every tree fits its card\'s frame (the bake would cut it), and stays light (a one-off bake: ≤ 16 k triangles a tree)', () => {
  M.forEach((m, l) => {
    assert.ok(m.reach <= SHAPES[l].R, `${m.id}: reach ${m.reach.toFixed(3)} within R ${SHAPES[l].R}`);
    assert.ok(m.top <= 1.0 && m.bottom >= -0.06, `${m.id}: height ${m.bottom.toFixed(3)}..${m.top.toFixed(3)}`);
    assert.ok(m.ni / 3 <= 16000, `${m.id}: ${m.ni / 3} triangles`);
    // T1: the frame holds the whole crown: no bough is cut to the frame's width (the old cut made every lower fir bough
    // one length: a column)
    assert.equal(m.clipped ?? 0, 0, `${m.id}: ${m.clipped} boughs cut by the frame`);
  });
});

test('T1: the firs taper (a wide skirt, a narrow spire) and the lower boughs are not one length', () => {
  const band = (m, y0, y1) => { const r = []; for (let i = 0; i < m.nv; i++) { const v = vtx(m, i); if (v.kind !== KIND.bark && v.p[1] >= y0 && v.p[1] < y1) r.push(Math.hypot(v.p[0], v.p[2])); } return r.sort((a, b) => a - b); };
  for (const m of M.filter((x) => /fir/.test(x.id))) {
    const low = band(m, 0.0, 0.3), mid = band(m, 0.45, 0.6), top = band(m, 0.75, 0.9);
    const p95 = (a) => a[Math.floor(a.length * 0.95)];
    assert.ok(p95(mid) < 0.8 * p95(low) && p95(top) < 0.6 * p95(low), `${m.id}: crown ${p95(low).toFixed(3)} / ${p95(mid).toFixed(3)} / ${p95(top).toFixed(3)} (foot / middle / top)`);
    // the skirt's outermost reaches spread (not a cut edge): its top 5 % of radii span more than 8 % of the skirt
    assert.ok(low.at(-1) - p95(low) > 0.08 * low.at(-1) || p95(low) - low[Math.floor(low.length * 0.8)] > 0.08 * low.at(-1), `${m.id}: a ragged skirt`);
  }
});

test('true normals: every sheet carries its own surface\'s normal (its triangles\', area-weighted), not one bent toward the crown\'s ball', () => {
  for (const m of M) {
    const acc = new Float64Array(m.nv * 3); let radial = 0, faceRadial = 0, nf = 0;
    for (let t = 0; t < m.ni; t += 3) {
      const a = vtx(m, m.I[t]), b = vtx(m, m.I[t + 1]), c = vtx(m, m.I[t + 2]);
      if (a.kind !== KIND.spray && a.kind !== KIND.curtain) continue;   // tufts and leaves are cupped by design (below)
      let f = cross(sub(b.p, a.p), sub(c.p, a.p)); if (dot(f, a.n) < 0) f = f.map((x) => -x);
      for (const i of [m.I[t], m.I[t + 1], m.I[t + 2]]) { acc[i * 3] += f[0]; acc[i * 3 + 1] += f[1]; acc[i * 3 + 2] += f[2]; }
      const fn = unit(f), mid = [(a.p[0] + b.p[0] + c.p[0]) / 3, 0, (a.p[2] + b.p[2] + c.p[2]) / 3];
      faceRadial += Math.abs(dot(fn, unit(mid))); nf++;
    }
    let n = 0, agree = 0;
    for (let i = 0; i < m.nv; i++) {
      const v = vtx(m, i); if (v.kind !== KIND.spray && v.kind !== KIND.curtain) continue;
      const g = [acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]]; if (Math.hypot(...g) < 1e-12) continue;
      n++; if (dot(v.n, unit(g)) > 0.995) agree++;
      radial += Math.abs(dot(v.n, unit([v.p[0], 0, v.p[2]])));
    }
    if (!n) continue;
    assert.equal(agree, n, `${m.id}: ${n - agree} of ${n} sheet normals off their own triangles`);
    // the old bake bent 45 % toward the crown's outward direction; a true normal leans out no more than the faces do
    assert.ok(radial / n <= faceRadial / nf + 0.05, `${m.id}: outward lean ${(radial / n).toFixed(3)} vs the faces' ${(faceRadial / nf).toFixed(3)}`);
  }
  // a tuft or a leaf sheet is a cupped cluster: its normals lean out from its middle, but never more than 70° off its face
  for (const m of M) for (let t = 0; t < m.ni; t += 3) {
    const a = vtx(m, m.I[t]), b = vtx(m, m.I[t + 1]), c = vtx(m, m.I[t + 2]);
    if (a.kind !== KIND.tuft && a.kind !== KIND.leaf) continue;
    const f = cross(sub(b.p, a.p), sub(c.p, a.p)); if (Math.hypot(...f) < 1e-9) continue;
    for (const v of [a, b, c]) assert.ok(Math.abs(dot(v.n, unit(f))) > 0.3, `${m.id}: a cupped normal within 70° of its face`);
  }
});

test('no shade baked: a vertex carries a material, ao and open sky in 0..1, the same for every sun (there is no sun input)', () => {
  for (const m of M) for (let i = 0; i < m.nv; i++) {
    const v = vtx(m, i);
    assert.ok(v.ao >= 0 && v.ao <= 1 && v.open >= 0 && v.open <= 1, `${m.id}: ao ${v.ao} open ${v.open}`);
    assert.ok(Math.abs(Math.hypot(...v.n) - 1) < 1e-3, `${m.id}: unit normal`);
  }
  // the crown keeps its own light: deep in it (near the stem) the sky's share is lower than at its rim
  const fir = M[3]; let inner = [], outer = [];
  for (let i = 0; i < fir.nv; i++) { const v = vtx(fir, i); if (v.kind !== KIND.spray) continue; const r = Math.hypot(v.p[0], v.p[2]); (r < 0.04 ? inner : r > 0.1 ? outer : []).push(v.ao * (0.3 + 0.7 * v.open)); }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(mean(inner) < 0.6 * mean(outer), `inner ${mean(inner).toFixed(3)} vs outer ${mean(outer).toFixed(3)}`);
  assert.equal(SPECIES.length, SHAPES.length);
});
