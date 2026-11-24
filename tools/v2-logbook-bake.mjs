// The logbook's world for v2 (fix(v2): LOG): what v1's Sail logbook (src/sail/logbook.js) reads from v1's world and v2 does not
// build: the terrain's lake and landmarks (the island's ellipse, the bay's mouth, the waterfall, the stone house, the ruin), the
// traced shoreline (layoutShoreline: the shore, the light tower, the named places) and the harbour's plan (harbourLayout: the
// entrance and the basin). v1 makes them at boot from its terrain module (a top-level fetch of v1's grids, which v2 never loads);
// this bakes v1's own results once, in node, into v2/ui/logbookWorld.json (committed; re-run after any change to the terrain,
// the shoreline rules or the harbour). Only what the logbook reads is kept: the shore at the chart's 20 m step (buildChart thins
// it the same way, so its output is the same), the places' points.
//   node tools/v2-logbook-bake.mjs            write v2/ui/logbookWorld.json
//   node tools/v2-logbook-bake.mjs --check    exit 1 if the committed file differs from a fresh bake
// v2/tests/logbook.test.mjs runs the same check (bakeWorld) and drives v1's buildChart and placesFrom on both.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = resolve(ROOT, 'v2/ui/logbookWorld.json');
const SEED = 1;           // v1's world seed (src/core/params.js SEED, the default)
const STEP = 20;          // m: buildChart's default thinning of the shore (src/ui/logbookChart.js)

const pt = (p) => ({ x: p.x, z: p.z });

export async function bakeWorld() {
  const { makeTerrain } = await import('../src/sim/terrain.js');
  const { layoutShoreline } = await import('../src/shoreline-layout.js');
  const { harbourLayout } = await import('../src/harbour-layout.js');
  const T = makeTerrain({ seed: SEED });
  const L = layoutShoreline(T, { seed: SEED });
  const H = harbourLayout({ terrain: T, seed: SEED });
  const shore = [];
  let last = -1e9;
  for (const p of L.shore) if (p.s - last >= STEP) { shore.push({ x: p.x, z: p.z, s: p.s }); last = p.s; }
  const I = T.lake.island, M = T.lake.mouth, fall = T.waterfall();
  return {
    v: 1, seed: SEED, step: STEP,
    terrain: {
      lake: { island: { x: I.x, z: I.z, a: I.a, b: I.b, rotDeg: I.rotDeg, top: I.top }, mouth: { a: M.a, b: M.b, halfWidth: M.halfWidth } },
      landmarks: { waterfall: pt(T.landmarks.waterfall), house: pt(T.landmarks.house), ruin: T.landmarks.ruin ? pt(T.landmarks.ruin) : null },
      mouth: { a: T.mouth.a, b: T.mouth.b },
      waterfall: { x: fall.x, z: fall.z, top: fall.top, bottom: fall.bottom, a: fall.a, b: fall.b },
    },
    shoreline: { shore, tower: L.tower ? { x: L.tower.x, z: L.tower.z, y: L.tower.y } : null, places: { mouth: L.places.mouth.map(pt) } },
    harbour: { entrance: { centre: H.entrance.centre }, enclosure: H.enclosure ?? [] },
  };
}

export const stringify = (w) => JSON.stringify(w) + '\n';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fresh = stringify(await bakeWorld());
  if (process.argv.includes('--check')) {
    let now = ''; try { now = readFileSync(OUT, 'utf8'); } catch { /* none yet */ }
    if (now !== fresh) { console.error('v2/ui/logbookWorld.json is stale: run node tools/v2-logbook-bake.mjs'); process.exit(1); }
    console.log('v2/ui/logbookWorld.json is current');
  } else {
    writeFileSync(OUT, fresh);
    const w = JSON.parse(fresh);
    console.log(`wrote v2/ui/logbookWorld.json: ${fresh.length} bytes, ${w.shoreline.shore.length} shore points, harbour ${w.harbour.enclosure.length} points`);
  }
}
