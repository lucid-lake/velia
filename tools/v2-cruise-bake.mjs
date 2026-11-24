// Cruise's chart objects for v2 (BACKLOG-v2 #11): what v1's Cruise navigator charts besides the shore and the depth (src/sim/modes/
// chill/navigator.js buildChart: the shoreline's piers, mooring balls, the field off the bay head, the hazard and 5-mph buoys,
// and the harbour's breakwaters, docks and basin). v1's page makes them at boot from its world (src/core/world.js: layoutShoreline
// with the towns' OpenStreetMap piers, src/towns-layout.js osmPiers; harbourLayout with its slips empty); v2 draws the same piers
// (tools/v2-towns-pack.mjs bakes them so) but never builds v1's towns layout, so this bakes v1's own results once, in node, into
// v2/cruise/chartWorld.json (committed; re-run after any change to the terrain, the shoreline rules, the towns' data or the harbour).
// Only what buildChart reads is kept. The shore and the depth come from v2's own lake terrain (v2/sim/lake.js) on the page.
//   node tools/v2-cruise-bake.mjs            write v2/cruise/chartWorld.json
//   node tools/v2-cruise-bake.mjs --check    exit 1 if the committed file differs from a fresh bake
// v2/tests/cruise.test.mjs runs the same check (bakeChartWorld).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = resolve(ROOT, 'v2/cruise/chartWorld.json');
const SEED = 1;   // v1's world seed (src/core/params.js SEED, the default)
const r3 = (v) => v;   // full precision: the same numbers v1 charts
const pt = (p) => ({ x: r3(p.x), z: r3(p.z) });

export async function bakeChartWorld() {
  const { makeTerrain } = await import('../src/sim/terrain.js');
  const { makeGeo } = await import('../src/sim/geo.js');
  const { CURRENT_WATERS } = await import('../src/sim/waters/current.js');
  const { loadTownsData, buildTownsLayout } = await import('../classic/src/towns-layout.js');
  const { layoutShoreline } = await import('../src/shoreline-layout.js');
  const { harbourLayout } = await import('../src/harbour-layout.js');
  const T = makeTerrain({ seed: SEED });
  const towns = buildTownsLayout(await loadTownsData(), { heightAt: T.heightAt, lonLatToWorld: makeGeo(CURRENT_WATERS).lonLatToWorld });
  const L = layoutShoreline(T, { seed: SEED, realPiers: towns.osmPiers });   // v1's page (src/core/world.js): the real piers
  const H = harbourLayout({ terrain: T, seed: SEED });
  const xz = (a) => [r3(a[0]), r3(a[1])];
  return {
    v: 1, seed: SEED,
    shoreline: {
      piers: L.piers.map((p) => ({ x: r3(p.x), z: r3(p.z), dirX: r3(p.dirX), dirZ: r3(p.dirZ), length: r3(p.length), width: p.width != null ? r3(p.width) : null })),
      balls: L.balls.map(pt), field: (L.field ?? []).map(pt), hazards: (L.hazards ?? []).map(pt), speedLine: (L.speedLine ?? []).map(pt),
    },
    harbour: {
      breakwaters: (H.breakwaters ?? []).map((b) => ({ path: b.path.map(xz), baseWidth: b.baseWidth ?? null })),
      docks: (H.docks ?? []).map((d) => ({ a: xz(d.a), b: xz(d.b), width: d.width ?? null })),
      enclosure: (H.enclosure ?? []).map(xz),
    },
  };
}

export { chartInputs } from '../v2/cruise/chartRows.js';   // the baked rows as buildChart reads them (the page's own module)

export const stringify = (w) => JSON.stringify(w) + '\n';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fresh = stringify(await bakeChartWorld());
  if (process.argv.includes('--check')) {
    let now = ''; try { now = readFileSync(OUT, 'utf8'); } catch { /* none yet */ }
    if (now !== fresh) { console.error('v2/cruise/chartWorld.json is stale: run node tools/v2-cruise-bake.mjs'); process.exit(1); }
    console.log('v2/cruise/chartWorld.json is current');
  } else {
    writeFileSync(OUT, fresh);
    const w = JSON.parse(fresh);
    console.log(`wrote v2/cruise/chartWorld.json: ${fresh.length} bytes, ${w.shoreline.piers.length} piers, ${w.shoreline.balls.length} balls, ${w.shoreline.field.length} field, ${w.shoreline.hazards.length + w.shoreline.speedLine.length} buoys, ${w.harbour.breakwaters.length} breakwaters`);
  }
}
