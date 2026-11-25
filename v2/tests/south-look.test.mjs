// South Lake's look (Off Ski Run): the bay-only layers follow the start's detail level (v2/terrain/region.js levelKeyOfBirth):
// the rules' forest region (forest/lod.js forestRegion), the canopy grid over it, the rocks' and the bed's stones' box
// (terrain/rocks-rules.js rocksFor), the shore-break field (render/shore.js shoreFile, shoreCap; the committed south bake).
// A start in the bay keeps every bay constant; a start elsewhere without a level too. Behaviour, not source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { REGION, REGIONS, forestRegion, regionSlots, REGION_SLOTS, createTilePicker, FOREST, SOURCE } from '../forest/lod.js';
import { scatterSlot, scatterWgsl, SCATTER_WGSL } from '../forest/scatter.js';
import { gridOf, CANOPY } from '../forest/canopy.js';
import { ROCKS, ROCK_BOXES, rocksFor, SLOT_COUNT, COLS, ROCKS_WGSL, rockSlot } from '../terrain/rocks-rules.js';
import { bedGridsFor, bedWindow, BED_GRIDS, BED_SLOTS, BED_W, scatterWgsl as rocksScatterWgsl } from '../render/rocks.js';
import { SHORE_FILE, SHORE_FILES, shoreFile, SHORE_CAP, shoreCap } from '../render/shore.js';
import { decodeShore, gpuWords, sampleShore, PARAM_WORDS } from '../sim/shoreField.js';
import { levelKeyOfBirth } from '../terrain/region.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { frustumPlanes, boxInFrustum } from '../terrain/quadtree.js';
import { lintWgsl } from '../engine/wgsl-lint.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOUTH = JSON.parse(readFileSync(resolve(ROOT, 'terrain/south/south.json'), 'utf8'));
const KEY = levelKeyOfBirth(CURRENT_WATERS, 'ski-run');
const PIN = { x: 11800, z: -875 };

test('the level keys: Off Ski Run starts on South Lake\'s level, the bay\'s birthplaces on the bay\'s', () => {
  assert.equal(KEY, 'south-lake');
  assert.equal(levelKeyOfBirth(CURRENT_WATERS, 'tessie'), 'bay');
  assert.equal(levelKeyOfBirth(CURRENT_WATERS, 'no-such-place'), 'bay');
});

test('the rules\' forest region: the south box has the bay\'s tile count, finer cells on a desktop (28 a tile) and the bay\'s on a phone, and holds the town and Heavenly; the bay\'s is REGION', () => {
  const S = forestRegion(KEY), B = forestRegion('bay'), P = forestRegion(KEY, 'phone');
  assert.equal(B, REGION); assert.equal(forestRegion('nowhere'), REGION); assert.equal(forestRegion('bay', 'phone'), REGION); assert.equal(REGIONS[KEY], S);
  assert.equal(S.n, 28); assert.ok(Math.abs(S.n * S.cell - S.tile) < 1e-9, 'the cells tile the tile');
  assert.equal(regionSlots(S), REGION_SLOTS * (28 * 28) / (20 * 20)); assert.equal(regionSlots(), REGION_SLOTS);
  assert.equal(P.n, REGION.n); assert.equal(P.cell, REGION.cell); assert.equal(P.x0, S.x0); assert.equal(regionSlots(P), REGION_SLOTS);
  assert.equal(S.tile, REGION.tile); assert.equal(S.tw, REGION.tw); assert.equal(S.th, REGION.th);
  const x1 = S.x0 + S.tw * S.tile, z1 = S.z0 + S.th * S.tile;
  for (const [x, z, what] of [[PIN.x, PIN.z, 'the pin'], [12211, 363, 'Ski Run Marina'], [13600, 2400, 'the look point on Heavenly'], [16400, 2700, 'Heavenly\'s summit'], [SOUTH.box.x1 - 1, SOUTH.box.z1 - 1, 'the level\'s south-east corner']]) {
    assert.ok(x >= S.x0 && x < x1 && z >= S.z0 && z < z1, `${what} (${x}, ${z}) inside the south region`);
  }
  // the WGSL and the twin read the region they are given: the south's first cell lies at its corner, not the bay's
  const w = scatterWgsl(S);
  assert.ok(w.includes(`const RX0 = ${S.x0.toFixed(1)}`) && w.includes(`const RZ0 = ${S.z0.toFixed(1)}`));
  assert.equal(SCATTER_WGSL, scatterWgsl(REGION));
  const ctx = { field: { height: () => 0 }, cover: () => new Array(11).fill(0), S: { snowLine: 3000, fullM: 100, aspectM: 300, maxSlope: 1 }, treeline: 1002, y0: 1897.89 };
  const a = scatterSlot(0, 0, ctx, S), b = scatterSlot(0, 0, ctx);
  assert.ok(Math.abs(a.x - S.x0) < S.cell && Math.abs(a.z - S.z0) < S.cell, `the south twin's cell 0 at the south corner (${a.x}, ${a.z})`);
  assert.ok(Math.abs(b.x - REGION.x0) < REGION.cell, 'the bay twin unchanged');
});

test('the canopy grid follows the region: the same size, the south corner; the bay\'s grid is CANOPY\'s', () => {
  const S = forestRegion(KEY), g = gridOf('desktop', S), b = gridOf('desktop');
  assert.equal(g.nx, b.nx); assert.equal(g.nz, b.nz); assert.equal(g.texel, 8);
  assert.equal(g.x0, S.x0); assert.equal(g.z0, S.z0); assert.equal(b.x0, CANOPY.desktop.x0); assert.equal(b.x0, REGION.x0);
  assert.equal(gridOf('phone', S).texel, 16);
});

test('the tile picker over the south region: from the pin, tiles round the town and up Heavenly, none of the bay\'s', () => {
  const S = forestRegion(KEY), L = FOREST.desktop;
  const ground = (x0, z0, x1, z1, out) => { const inSouth = x1 > SOUTH.box.x0 && x0 < SOUTH.box.x1 && z1 > SOUTH.box.z0 && z0 < SOUTH.box.z1; out[0] = inSouth ? 0 : 1e9; out[1] = inSouth ? 400 : -1e9; };   // land everywhere in the level's box, no data outside (a stub)
  const picker = createTilePicker({ L, ground, boxInFrustum, offsets: { shrubs: 0, region: 1000 }, region: S });
  picker.src.region = true;
  // a wide view from the pin toward the look point (an orthographic box round the eye: every tile in range passes)
  const planes = frustumPlanes(new Float32Array([1 / 20000, 0, 0, 0, 0, 1 / 20000, 0, 0, 0, 0, 1 / 20000, 0, 0, 0, 0, 1]), new Float32Array(24));
  const n = picker.pick([PIN.x, 5, PIN.z], planes);
  assert.ok(n > 100, `${n} tiles picked`);
  const per = S.n * S.n;
  for (let k = 0; k < n; k++) {
    const first = picker.out[4 * k], src = picker.out[4 * k + 2];
    assert.equal(src, SOURCE.region);
    const t = (first - 1000) / per, x0 = S.x0 + (t % S.tw) * S.tile, z0 = S.z0 + Math.floor(t / S.tw) * S.tile;
    assert.ok(Number.isInteger(t) && x0 >= SOUTH.box.x0 - S.tile && x0 < SOUTH.box.x1 && z0 < SOUTH.box.z1, `tile ${t} at (${x0}, ${z0}) in the level's box`);
    assert.ok(Math.hypot(Math.max(0, Math.abs(x0 + 128 - PIN.x) - 128), Math.max(0, Math.abs(z0 + 128 - PIN.z) - 128)) <= L.far + 1, 'within far');
  }
});

test('the rocks\' box follows the level: the south box over the level, more slots, its own WGSL constants; the bay\'s are the constants', () => {
  const S = rocksFor(KEY), B = rocksFor('bay'), N = rocksFor('nowhere');
  assert.deepEqual(B.box, ROCKS.box); assert.equal(B.slots, SLOT_COUNT); assert.equal(B.cols, COLS); assert.equal(B.wgsl, ROCKS_WGSL); assert.equal(B.key, 'bay');
  assert.equal(N.key, 'bay'); assert.equal(N.slots, SLOT_COUNT);
  assert.equal(S.key, KEY); assert.deepEqual(S.box, ROCK_BOXES[KEY]);
  assert.ok(S.box.x0 >= SOUTH.box.x0 && S.box.x1 <= SOUTH.box.x1 && S.box.z0 >= SOUTH.box.z0 && S.box.z1 <= SOUTH.box.z1, 'inside the level\'s box');
  assert.ok(PIN.x > S.box.x0 && PIN.x < S.box.x1 && 12211 < S.box.x1 && 363 < S.box.z1, 'the pin and the marina inside it');
  assert.equal(S.cols, Math.ceil((S.box.x1 - S.box.x0) / ROCKS.cell)); assert.equal(S.slots, S.cols * Math.ceil((S.box.z1 - S.box.z0) / ROCKS.cell));
  assert.ok(S.slots > SLOT_COUNT && S.slots < 3 * SLOT_COUNT, `${S.slots} slots`);
  assert.ok(S.wgsl.includes(`const RK_X0 = ${S.box.x0.toFixed(1)}`) && S.wgsl.includes(`const RK_N = ${S.slots}u`));
  // the twin reads the box it is given: cell 0 at the south corner
  const ctx = { field: { height: () => -5 }, cover: () => new Array(11).fill(0), S: { snowLine: 3000, fullM: 100, aspectM: 300, maxSlope: 1 }, y0: 1897.89 };
  const r = rockSlot(0, 0, ctx, S.box);
  assert.ok(Math.abs(r.x - S.box.x0) < ROCKS.cell && Math.abs(r.z - S.box.z0) < ROCKS.cell);
  assert.equal(r.why, 'deep');
  // the south's inland rule: a 1:6 shelf under a flat beach grows no rock; the same shelf under climbing land does; the bay's text has no such rule
  assert.equal(S.inland, 0.09); assert.equal(B.inland, 0); assert.ok(S.wgsl.includes('SHORE_INLAND') && !B.wgsl.includes('SHORE_INLAND'));
  const shelf = (flatLand) => ({ ...ctx, field: { height: (x, z) => { const d = z - S.box.z0 - 100; return d < 0 ? d / 6 : flatLand ? 0.02 * d : d / 6; } } });   // the waterline 100 m into the box, +z land
  const cells = []; for (let cj = 0; cj < 40; cj++) for (let ci = 0; ci < 6; ci++) cells.push([ci, cj]);
  const on = (c, inl) => cells.filter(([ci, cj]) => rockSlot(ci, cj, c, S.box, inl).valid).length;
  assert.ok(on(shelf(true), 0) > 0, 'without the rule the flat beach grows rocks');
  assert.equal(on(shelf(true), S.inland), 0, 'with it the flat beach grows none');
  assert.ok(on(shelf(false), S.inland) > 0, 'climbing land behind the shelf keeps its rocks');
});

test('the bed\'s stones over the south box: the grids cover it, the window of South Lake\'s disc has slots there (none on the bay\'s box); the shader takes its workgroups', () => {
  const S = rocksFor(KEY), G = bedGridsFor(S.box);
  assert.deepEqual(bedGridsFor().grids, BED_GRIDS); assert.equal(bedGridsFor().slots, BED_SLOTS); assert.equal(bedGridsFor().W, BED_W);
  assert.ok(G.slots > BED_SLOTS, `${G.slots} slots over the south box`);
  for (const [i, g] of G.grids.entries()) {
    const c = [7.5, 5.0, 3.2, 4.1][i] ?? null; if (c == null) continue;
    assert.ok(g.ix0 * c <= S.box.x0 && (g.ix0 + g.cols) * c >= S.box.x1 && g.iz0 * c <= S.box.z0 && (g.iz0 + g.rows) * c >= S.box.z1, `layer ${i} covers the box`);
  }
  const disc = [[10500, 500, 2500 + 250]];   // South Lake's region disc with the margin (v2/sim/bedBoulders.js BED_REGION)
  assert.equal(bedWindow(disc).slots, 0, 'on the bay\'s box: nothing');
  const w = bedWindow(disc, G.grids, G.box);
  assert.ok(w.slots > 0 && w.slots <= G.slots, `${w.slots} slots in the south window`);
  const text = rocksScatterWgsl({ bed: true, rules: S, bedW: G.W });
  assert.ok(text.includes(`const BED_W = ${G.W}u`) && text.includes(`const RK_N = ${S.slots}u`));
  assert.ok(text.includes('SHORE_INLAND') && !rocksScatterWgsl({ bed: true }).includes('SHORE_INLAND'), 'the south\'s emergent blocks take the inland rule; the bay\'s text has none');
  assert.equal(lintWgsl(text).length, 0, 'the south scatter lints');
});

test('the shore-break field follows the level: the south file and its 8 MB buffer for a south start, the bay\'s for the bay; the committed south bake', () => {
  assert.equal(shoreFile('bay'), SHORE_FILE); assert.equal(shoreFile('nowhere'), SHORE_FILE); assert.equal(shoreFile(KEY), SHORE_FILES[KEY]);
  assert.ok(SHORE_FILES[KEY].pathname.endsWith('/assets/shore/shore-south.vsf.gz'));
  assert.equal(shoreCap('bay'), SHORE_CAP); assert.equal(shoreCap(KEY), 8 << 20);
  const F = decodeShore(gunzipSync(readFileSync(resolve(ROOT, 'v2/assets/shore/shore-south.vsf.gz'))));
  const H = F.head;
  assert.equal(H.texel, 2); assert.ok(H.x0 >= SOUTH.box.x0 && H.z0 >= SOUTH.box.z0, 'the bake starts inside the level\'s box');
  assert.ok(H.x0 + H.tilesX * H.tile * H.texel <= SOUTH.box.x1 && H.z0 + H.tilesZ * H.tile * H.texel <= SOUTH.box.z1, 'and ends inside it');
  assert.ok(H.nTiles > 1500 && H.nTiles < 4000, `${H.nTiles} tiles`);
  const words = gpuWords(F);
  assert.ok(words.byteLength > SHORE_CAP && words.byteLength <= shoreCap(KEY), `${words.byteLength} B: over the bay's 4 MB, within the south's 8 MB`);
  for (let i = 0; i < PARAM_WORDS; i++) assert.equal(words[i], 0, 'the params start off');
  // the town's beach east of Ski Run Marina (the waterline at z ≈ 220 for x 12,400): a front runs onto it from the north
  const near = sampleShore(F, 12400, 210), off = sampleShore(F, 12400, 170);
  assert.ok(near && near.fade > 0.5, `fade at the beach ${near?.fade}`);
  assert.ok(off && off.tau1 > near.tau1, `τ ${off?.tau1?.toFixed(2)} offshore vs ${near.tau1.toFixed(2)} near`);
  assert.ok(near.dz > 0.6, `the front runs south onto the beach (dir ${near.dx.toFixed(2)}, ${near.dz.toFixed(2)})`);
  assert.equal(sampleShore(F, PIN.x, PIN.z), null, 'the pin in 23 m of water holds no field');
  assert.equal(sampleShore(F, 900, -900), null, 'the bay holds none of the south\'s field');
});
