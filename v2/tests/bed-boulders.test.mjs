// feat/v2-boulders-3d (P1): the bed's 3D stones. Their clearance (no keel or hull meets one), the zones kept clear,
// a phone's shaders unchanged, the painted twin's placement text shared, the smooth mesh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BED3D, topMax, stoneHeight, clearZones, inClearZone, CLEAR_R, FIXED_STARTS } from '../sim/bedBoulders.js';
import { scatterWgsl, SCATTER_WGSL, cullWgsl, CULL_WGSL, ROCK_BED_WGSL, boulderMesh, BED_GRIDS, BED_SLOTS } from '../render/rocks.js';
import { BED_HASH_WGSL, BED_CELL_WGSL, BIG, bedWgsl } from '../render/bed.js';
import { ROCKS } from '../terrain/rocks-rules.js';
import { ANCHORED_BOATS } from '../sim/anchoredBoats.js';

test('the clearance: wherever a keel floats, every stone\'s top stays keel + 0.5 m down; above the surface only in under 1 m of water', () => {
  const keelClear = -(BED3D.keel + BED3D.under);
  for (let dep = 0.05; dep <= BED3D.depth[1]; dep += 0.05) {
    for (const r of [0.7, 1.4, 2.0, 3.0]) for (const steep of [0, 0.3, 1.2]) {
      const st = stoneHeight(r, dep, steep);
      if (!st) continue;
      const top = st.cy + st.a;
      assert.ok(top <= topMax(dep) + 1e-9, `top ${top.toFixed(2)} within the rule at ${dep.toFixed(2)} m`);
      if (dep >= BED3D.keel) assert.ok(top <= keelClear + 1e-9, `a keel floating over ${dep.toFixed(2)} m clears a ${r} m stone (top ${top.toFixed(2)})`);
      if (top > 0) assert.ok(dep < 1.0, `a stone above the surface only in under 1 m of water (${dep.toFixed(2)} m)`);
      assert.ok(st.a >= BED3D.minA && st.a <= r * BED3D.flat + 1e-9, 'a dome no taller than the painted one, none lower than minA');
    }
  }
  // the band a keel just clears has no stone at all; the deep shelf's stones are big (the photos' 3-9 m)
  for (const dep of [1.3, 1.6, 2.0]) assert.equal(stoneHeight(2, dep, 0), null, `none in ${dep} m`);
  assert.ok(stoneHeight(3, 6, 0).a >= 2.3, 'a 6 m stone in 6 m of water stands 2.4 m');
  assert.equal(stoneHeight(2, BED3D.depth[1] + 0.5, 0), null, 'none past the painted ones');
});

test('the zones kept clear: every mooring ball, the boats at anchor, the starts and the birthplaces', () => {
  const moorings = [{ x: -100, z: -300 }, { x: -80, z: -310 }];
  const births = [{ x: 460, z: -50 }, { x: NaN, z: 0 }];
  const z = clearZones({ moorings, anchored: ANCHORED_BOATS, birthplaces: births });
  assert.ok(inClearZone(z, -100, -300 + CLEAR_R.mooring - 1) && !inClearZone(z, -100, -300 + CLEAR_R.mooring + 30));
  for (const b of ANCHORED_BOATS.filter((b) => b.at)) assert.ok(inClearZone(z, b.at[0] + CLEAR_R.anchored - 1, b.at[1]), b.id);
  for (const [x, zz] of FIXED_STARTS) assert.ok(inClearZone(z, x, zz + CLEAR_R.start - 1));
  assert.ok(inClearZone(z, 460, -50) && z.every((r) => r.every(Number.isFinite)), 'a birthplace kept, a bad row skipped');
  assert.ok(clearZones({ moorings: Array.from({ length: 100 }, () => ({ x: 0, z: 0 })) }).length <= 64, 'the uniform holds 64');
});

test('a phone\'s rocks are the same shaders; the bed\'s stones only where compiled in', () => {
  assert.equal(scatterWgsl({ bed: false }), SCATTER_WGSL); assert.equal(cullWgsl({ bed: false }), CULL_WGSL);
  assert.ok(!SCATTER_WGSL.includes('bedSlot') && !CULL_WGSL.includes('cullBed'));
  const s = scatterWgsl({ bed: true }), c = cullWgsl({ bed: true });
  assert.ok(s.includes('fn bedSlot') && s.includes('bedDone()') && c.includes('fn cullBed'));
  // the painted twin's text: the same hash and cell code in both passes, so each 3D stone stands on its painted stone
  assert.ok(s.includes(BED_HASH_WGSL) && s.includes(BED_CELL_WGSL) && bedWgsl({ big: true }).includes(BED_HASH_WGSL));
  for (const L of BIG.layers) assert.ok(s.includes(L.salt.toFixed(2)) && s.includes(L.cell.toFixed(2)), `layer ${L.cell} m`);
  const d = ROCK_BED_WGSL('struct Frame { x: f32 }');
  for (const k of ['uwApparent', 'waveCaustic', 'causticStrength', 'TINT_SHELF', 'fn vs', 'fn fs']) assert.ok(d.includes(k), k);
});

test('the grids cover the box; the smooth mesh; the shore rocks\' mesh unchanged', () => {
  const all = [...BIG.layers, BED3D.emerge];
  assert.equal(BED_GRIDS.length, all.length, 'the four painted layers and the emergent stones');
  for (const [i, g] of BED_GRIDS.entries()) {
    const L = all[i];
    assert.ok(g.ix0 * L.cell <= ROCKS.box.x0 && (g.ix0 + g.cols) * L.cell >= ROCKS.box.x1);
    assert.ok(g.iz0 * L.cell <= ROCKS.box.z0 && (g.iz0 + g.rows) * L.cell >= ROCKS.box.z1);
  }
  assert.equal(BED_SLOTS, BED_GRIDS.reduce((n, g) => n + g.cols * g.rows, 0));
  const shore = boulderMesh(), bed = boulderMesh({ subdiv: 2, lump: 0.35 });
  const far = boulderMesh({ subdiv: 1, lump: 0.35 }); assert.equal(far.triangles, 80, 'the far LOD');
  assert.equal(shore.vertices, 42); assert.equal(shore.triangles, 80);
  assert.equal(bed.vertices, 162); assert.equal(bed.triangles, 320);
  let maxR = 0; for (let i = 0; i < bed.vertices; i++) maxR = Math.max(maxR, Math.hypot(bed.pos[3 * i], bed.pos[3 * i + 1], bed.pos[3 * i + 2]));
  assert.ok(maxR <= 1.1, `the lumps stay within 1.1 of the radius (the draw's clearance divides by it): ${maxR.toFixed(3)}`);
});

test('round 2: packed to 4 m on a rocky shore, thinning deeper; emergent stones only at the waterline, never in a keel\'s water', async () => {
  const { bigDepthK, bedMean, ROCK_MEAN } = await import('../render/bed.js');
  for (const d of [0.5, 2, 4]) assert.equal(bigDepthK(d), 1, `packed at ${d} m`);
  assert.ok(Math.abs(bigDepthK(BIG.depthFull) - BIG.deepShare) < 1e-12 && bigDepthK(BIG.depthNone) === 0);
  for (let d = 0; d < 14; d += 0.25) assert.ok(bigDepthK(d + 0.25) <= bigDepthK(d) + 1e-12, 'thinning with depth');
  assert.equal(BIG.layers.length, 4); assert.ok(BIG.cover >= 0.7, 'the far mean of a packed field');
  const E = BED3D.emerge;
  assert.ok(E.h[0] >= -1.0 && E.h[1] <= 0.8, 'an emergent stone\'s centre sits at the waterline (under 1 m of water at most, or just up the shore)');
  assert.ok(E.rMin <= 0.5 && E.rMax >= 3.4 && E.lone > 0 && E.slab > 0, 'round 3: cobbles to 7 m blocks, lone blocks, slabs');
  assert.ok(-E.h[0] < BED3D.keel, 'in water no keel floats in');
  assert.ok(E.range >= 1000 && BED3D.lod > 0 && BED3D.lod < BED3D.grow[0]);
  const s = scatterWgsl({ bed: true });
  for (const k of ['fn big0At', 'fn vnoiseH', 'packBedT(r, aF, st', 'BB_STACK']) assert.ok(s.includes(k), k);
  const c = cullWgsl({ bed: true }); assert.ok(c.includes('bargs[9]') && c.includes('bedEmerge(b)'));
  // the stacked stone's top still keeps the rule (the scatter cuts a to topMax - cy): the twin of that cut
  for (const dep of [0.3, 0.9, 2.5, 5]) { const cy = -dep + 1.2; const a = Math.min(2 * BED3D.flat, topMax(dep) - cy); if (a >= BED3D.minA) assert.ok(cy + a <= topMax(dep) + 1e-9); }
});

test(': the stones placed round the player\'s regions, not the whole box; one set, one window', async () => {
  const { bedWindow, bedWindowData, BWIN_N, BED_REGION } = await import('../render/rocks.js');
  const { createStoneRegion, stoneDiscs } = await import('../sim/bedBoulders.js');
  const { REGIONS, activeRegions, regionsWithBirthplaces } = await import('../living/busyLake.js');
  const whole = bedWindow(null);
  assert.equal(whole.slots, BED_SLOTS, 'no regions: the whole box, as before');
  whole.layers.forEach((l, i) => { assert.equal(l.ix0, BED_GRIDS[i].ix0); assert.equal(l.cols, BED_GRIDS[i].cols); assert.equal(l.rows, BED_GRIDS[i].rows); });
  // the busy lake's regions: in either one today the set is both (neighbours), and the window is under the box
  const regs = regionsWithBirthplaces(REGIONS, REGIONS.map((r) => ({ region: r.id })));
  const sr = createStoneRegion({ regions: regs, active: activeRegions, marginM: BED_REGION.marginM });
  const d = sr.at(300, -400);
  assert.ok(d && d.length === 2, 'the bay and its neighbour');
  assert.equal(sr.at(2200, -1500), null, 'the neighbour\'s set is the same set: no re-place');
  assert.equal(sr.at(9000, 9000), null, 'outside every region the last set stays');
  const w = bedWindow(d);
  assert.ok(w.slots < BED_SLOTS && w.slots > 0.5 * BED_SLOTS, `the regions' window ${w.slots} of ${BED_SLOTS} slots`);
  // a lone far region: far fewer slots, inside the box
  const one = bedWindow(stoneDiscs(regs, new Set(['emerald-bay']), 0));
  assert.ok(one.slots < w.slots, 'one region pays less than two');
  for (const l of one.layers) assert.ok(l.cols >= 0 && l.rows >= 0 && l.end <= one.slots);
  assert.equal(bedWindow([[99999, 99999, 10]]).slots, 0, 'a region off the box places nothing');
  // determinism: the same discs give the same window and the same uniform
  assert.deepEqual(bedWindowData(bedWindow(d)), bedWindowData(bedWindow(d.map((x) => [...x]))));
  assert.equal(bedWindowData(w).length, BWIN_N * 4);
  // the scatter reads the window, not the box's constants
  const txt = scatterWgsl({ bed: true });
  assert.ok(txt.includes('var<uniform> BWIN') && txt.includes('fn inRegion(') && !txt.includes('BL_END = array'), 'the bed scatter runs over the window');
});

test(': the mouth\'s moraine counts as rocky for the paint and the 3D stones alike', async () => {
  const { bedMoraine, BED_MORAINE_WGSL } = await import('../render/bed.js');
  const [x, z, r] = BIG.moraine.zones[0];
  assert.equal(bedMoraine(x, z), 1); assert.equal(bedMoraine(1500, -1400), 1, 'the sill view\'s near water');
  assert.equal(bedMoraine(x + r + 1, z), 0); assert.equal(bedMoraine(-370, -120), 0, 'the north shore keeps its slope rule');
  assert.ok(scatterWgsl({ bed: true }).includes(BED_MORAINE_WGSL) && bedWgsl({ big: true }).includes(BED_MORAINE_WGSL), 'one text for the paint and the scatter');
  assert.ok(bedWgsl({ big: true }).includes('bedMoraine(pb)') && scatterWgsl({ bed: true }).includes('bedMoraine(bc.c)'));
});
