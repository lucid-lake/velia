// The home card's mini chart (v2/ui/birthplaceCard.js, v2/ui/miniChartData.js, tools/v2-minichart-bake.mjs): the shoreline is the real one,
// in the world's metres, so Fannette Island is land at 0, 0, every birthplace pin is on water inside the window with its name's room, and
// the baked file is the one a fresh bake writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MINI } from '../ui/miniChartData.js';
import { MINI_BOX } from '../ui/birthplaceCard.js';
import { birthplaceRows } from '../sim/regions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);   // the region table's birthplaces (v2/sim/regions.js)

// "M x z l dx dz … z" subpaths → loops of [x, z]
function loops(d) {
  const out = [];
  for (const part of d.split('M').slice(1)) {
    const [head, ...rest] = part.split('l');
    let [x, z] = head.split(' ').map(Number);
    const pts = [[x, z]];
    for (const seg of rest) { const [dx, dz] = seg.replace('z', '').split(' ').map(Number); x += dx; z += dz; pts.push([x, z]); }
    out.push(pts);
  }
  return out;
}
const inside = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) c = !c; } return c; };
const onLand = (pt) => loops(MINI.coast).filter((r) => inside(pt, r)).length % 2 === 1;

test('the chart window is the one the card places its pins in', () => {
  assert.deepEqual(MINI.box, [...MINI_BOX]);
});

test("Fannette Island is land at the summit (0, 0), a small closed loop of its own", () => {
  assert.ok(onLand([0, 0]), 'the summit is land');
  const island = loops(MINI.coast).filter((r) => inside([0, 0], r)).sort((a, b) => a.length - b.length)[0];
  const xs = island.map((p) => p[0]), zs = island.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs);
  assert.ok(w > 60 && w < 400 && h > 60 && h < 400, `an island of 60 to 400 m (${w} x ${h} m)`);
});

test('every birthplace pin is on water inside the window, with room for its name (a pin past it: at its edge, on water)', async () => {
  const [x0, z0, w, h] = MINI_BOX;
  const { edgePoint } = await import('../ui/chart/edge.js');
  for (const b of BIRTHPLACES) {
    const e = edgePoint(b.x, b.z, { x0, z0, x1: x0 + w, z1: z0 + h }, 0.06 * w), r = { ...b, x: e.x, z: e.z };
    assert.equal(e.far, b.id === 'ski-run', `${b.id}: past the window only South Lake's pin`);
    assert.ok(r.x > x0 + 0.04 * w && r.x < x0 + 0.96 * w && r.z > z0 + 0.04 * h && r.z < z0 + 0.96 * h, `${r.id} inside the window`);
    assert.ok(!onLand([r.x, r.z]), `${r.id} is on water`);
  }
});

test('the pins keep their real places: Off Fannette and Tessie\'s water east of the island, Vikingsholm at the bay\'s head', () => {
  const by = Object.fromEntries(BIRTHPLACES.map((r) => [r.id, r]));
  assert.ok(by.fannette.x > 0 && by.tessie.x > by.fannette.x, 'east of the island, Tessie\'s further');
  assert.ok(by.vikingsholm.x < 0 && by.vikingsholm.x < by.fannette.x, 'Vikingsholm west, at the head');
  assert.ok(by.narrows.z < by.tessie.z && by.lake.z < by.narrows.z, 'north is up: the narrows, then the open lake, out toward the mouth');
});

test('the shoreline has the rings the card draws and the file is a fresh bake', () => {
  assert.equal(MINI.rings.length, 3);
  assert.ok(MINI.coast.length > 2000 && MINI.coast.length < 40000, `coast ${MINI.coast.length} bytes`);
  execFileSync(process.execPath, [resolve(ROOT, 'tools/v2-minichart-bake.mjs'), '--check'], { stdio: 'pipe' });
});
