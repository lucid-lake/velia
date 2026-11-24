// Refactor round 3, A2 bug 6: only the page's first tick fills the lake at once; traffic that joins later (the morning) stays out of the eye's way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { steadyWind } from '../../src/sim/boat.js';
import { createBusyLake, BUSY } from '../living/busyLake.js';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { birthplaceRows } from '../sim/regions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);   // the region table's birthplaces (v2/sim/regions.js)
const C = planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(resolve(ROOT, 'v2/ui/planChart.bin'))))), chartInputs(JSON.parse(readFileSync(resolve(ROOT, 'v2/cruise/chartWorld.json'), 'utf8'))));

test('a page that opens at night and meets the morning: no boat pops in within the eye\'s reach', () => {
  const bp = BIRTHPLACES[0], S = { x: bp.x, z: bp.z, heading: 0, u: 0, v: 0, yawRate: 0 };
  const L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: (x, z) => C.depthAt(x, z), windAt: steadyWind(5, 225), tier: 'full', starts: [[WATERS.start.x, WATERS.start.z]], anchored: [] });
  L.post(S, 1 / 60, 0, { eye: [bp.x, 2, bp.z], hour: 21.5 });
  assert.equal(L.liveBoats.length, 0, 'night: none out');
  for (let i = 0; i < 60 * 3; i++) L.post(S, 1 / 60, 1 + i / 60, { eye: [bp.x, 2, bp.z], hour: 13 });
  assert.ok(L.liveBoats.length >= 1, 'the morning brings traffic');
  for (const b of L.liveBoats) assert.ok(Math.hypot(b.phys.state.x - bp.x, b.phys.state.z - bp.z) >= BUSY.popM - 1e-6, `${b.id} joined ${BUSY.popM} m or more from the eye`);
});
