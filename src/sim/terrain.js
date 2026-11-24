// Lakeshore terrain: the real Lake Tahoe basin. Plain JS, no three.js, so the wind field, the water, the bake workers
// and node tests can import it. The mesh and the material live in src/terrain-mesh.js.
//
// World frame (src/geo.js): x east, y up, z south, metres, true north; a transverse
// Mercator centred on Fannette Island's summit, so the island is the origin; y = 0 is the lake surface (the 2022
// lidar's water, 1,897.9 m NAVD88). Real scale: Emerald Bay runs ≈ 3 km from its head (south-west) to its mouth
// (north-east); the open lake lies north and north-east; its far shore is ≈ 33 km off.
//
// The heights are USGS data (tools/terrain/build_tahoe.py → terrain/*.lsh): 3DEP lidar (1 m on the island, 2 m over
// the bay), 10 m over the basin, 32 m over the lake, 96 m over the far Sierra ring to ≈ 49 km; the 1998 USGS multibeam
// under the water; NLCD 2021 for the ground cover. The module loads them with a top-level await (fetch in a page or a
// worker, the file system in node), so every importer gets a ready terrain.
//
//   import { makeTerrain, heightAt, shoreDistance, coverAt } from './terrain.js';
//   heightAt(x, z)        // → m above the lake surface (negative: the lake bed)
//   shoreDistance(x, z)   // → m to the shoreline, negative on the lake
//   coverAt(x, z)         // → { water, forest, rock, snow, beach, urban, shrub, grass, pond } weights 0–1
//   makeTerrain({ seed }) // → the object of all of these (the seed is kept for cache keys; the data has none), plus the
//                         //   lake's own: waters (its profile), lake (LAKE), landmarks (LANDMARKS), climate (TAHOE), place, geo
//   buildLake(waters, data) // → that object for any lake profile (src/waters/<id>.json) and its loaded grids
// The numbers that differ by lake (the named points, the bay, the season, the landmarks) are the profile's; this page's
// lake (src/waters/current.js) is loaded here once, and the exports below are its. Game code reads them from the terrain
// object it is given (createWorld passes it on), not from these exports (tests and tools may).
import { loadTerrain, makeSampler } from './terrain-data.js';
import { buildLakeOn } from './lake.js';
import { pickDay, dayChoice } from './day.js';
import { CURRENT_WATERS } from './waters/current.js';

// One lake from its profile and its decoded grids (loadTerrain(variant, waters)): src/sim/lake.js buildLakeOn over v1's
// sampler. Pure: the same profile, day and data give the same numbers.
export function buildLake(waters, data, day = pickDay(waters, dayChoice())) {
  return buildLakeOn(waters, makeSampler(data), day);
}

// this page's lake (src/waters/current.js), loaded once with a top-level await (fetch in a page or a worker, the file
// system in node), so every importer gets a ready terrain
const T = buildLake(CURRENT_WATERS, await loadTerrain(undefined, CURRENT_WATERS));
export const TAHOE = T.climate, LAKE = T.lake, LANDMARKS = T.landmarks;
export const { heightAt, shoreDistance, normalAt, slopeAt, coverAt, snowAt, fetchMap, places, waterfall, keepOut, islandR } = T;
export function makeTerrain({ seed = 1 } = {}) { return seed === 1 ? T : { ...T, seed }; }
// a lake's terrain object from its profile (createWorld({ waters })): this page's lake is the one loaded above; another
// profile loads its own grids (its terrain.dir) once and is built the same way (tests/profiles.test.mjs: a second lake)
const others = new Map();
export async function lakeTerrain(waters, { seed = 1, variant } = {}) {
  if (waters === CURRENT_WATERS || waters.id === CURRENT_WATERS.id) return makeTerrain({ seed });
  let t = others.get(waters.id);
  if (!t) others.set(waters.id, (t = buildLake(waters, await loadTerrain(variant, waters))));
  return seed === 1 ? t : { ...t, seed };
}
