// The chart's anchorages (v2/sim/anchorages.js findAnchorages) on the planner's whole-lake depth grid (v2/ui/planChart.bin and
// v2/cruise/chartWorld.json), written to v2/sim/anchorages.json: the page reads the file, so it pays nothing to find them.
// The lake's places a spot is named for: v1's bay names (anchorages.js BAY_PLACES) and the lake's coves and towns at their public
// lat, lon (rounded to about 100 m; a name, not a position), on the lake's own projection (src/sim/geo.js makeGeo).
//   node tools/v2-anchorage-bake.mjs            write v2/sim/anchorages.json
//   node tools/v2-anchorage-bake.mjs --check    exit 1 if the committed file differs from a fresh bake
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePlanGrid, planChart } from '../v2/ui/planChart.js';
import { chartInputs } from '../v2/cruise/chartRows.js';
import { findAnchorages, BAY_PLACES } from '../v2/sim/anchorages.js';
import { makeGeo } from '../src/sim/geo.js';
import { START } from '../v2/sim/boat.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = resolve(ROOT, 'v2/sim/anchorages.json');

// [name, lat, lon]
const LAKE_PLACES = [
  ['Camp Richardson', 38.938, -120.040], ['Baldwin Beach', 38.944, -120.062], ['Tahoe Keys', 38.933, -119.998],
  ['Rubicon Point', 39.001, -120.096], ['Meeks Bay', 39.037, -120.123], ['Sugar Pine Point', 39.056, -120.114],
  ['Homewood', 39.085, -120.160], ['Tahoe City', 39.168, -120.145], ['Carnelian Bay', 39.227, -120.080],
  ['Kings Beach', 39.238, -120.027], ['Crystal Bay', 39.228, -119.995], ['Sand Harbor', 39.198, -119.931],
  ['Glenbrook', 39.088, -119.939], ['Zephyr Cove', 39.006, -119.948], ['Nevada Beach', 38.980, -119.953],
];

export function bakeAnchorages() {
  const waters = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
  const geo = makeGeo(waters);
  const places = [...BAY_PLACES, ...LAKE_PLACES.map(([name, lat, lon]) => { const [x, z] = geo.lonLatToWorld(lon, lat); return { name, at: [Math.round(x), Math.round(z)], by: 'by' }; })];
  const world = JSON.parse(readFileSync(resolve(ROOT, 'v2/cruise/chartWorld.json'), 'utf8'));
  const chart = planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(resolve(ROOT, 'v2/ui/planChart.bin'))))), chartInputs(world));
  const spots = findAnchorages(chart, { start: [START.x, START.z], places });
  return `${JSON.stringify({ v: 1, spots: spots.map((s) => [s.x, s.z, s.depth, s.shelter, s.name]) })}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fresh = bakeAnchorages();
  if (process.argv.includes('--check')) {
    const same = readFileSync(OUT, 'utf8') === fresh;
    console.log(same ? 'v2/sim/anchorages.json matches a fresh bake' : 'v2/sim/anchorages.json differs from a fresh bake');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, fresh);
  for (const s of JSON.parse(fresh).spots) console.log(`${s[4].padEnd(36)} x ${String(s[0]).padStart(6)} z ${String(s[1]).padStart(7)}  ${s[2]} m  shelter ${s[3]}/16`);
}
