// The region detail levels (owner, 2026-11-24: "every birthplace outside the bay needs to load when it is selected"). A region row
// of the lake profile (src/waters/<id>.json `regions`, v2/sim/regions.js) may declare its own detail level:
//   level: { dir, full, phone, photo }   dir: the folder under the terrain's (terrain/south); full / phone: the level's manifests
//                                        (one level each, in the lake-wide frame and codes: tools/terrain/README.md § Region levels);
//                                        photo: its photo tiles' manifest (tools/v2-photo-tiles.mjs --region)
// The page fetches a region's level only when it starts at a birthplace in that region (startRegionLevel below): the level fills the bay's
// slot (heights, cover, shore distance, photo layer 0) in place of the bay's grids, which are then never fetched; the coarser levels
// (basin, lake, ring) and the island stay as they are and the region's edges blend into them as the bay's do (BLEND texels: the
// sampler walks the held levels finest first, so a level need not be nested in the next). A region with no `level` (Emerald Bay,
// the open lake) starts on the bay's level, as before. No region's detail is fetched for a start elsewhere.
//
// The swap hook (not built: owner, 2026-11-24, "no mid-sail swap for now"). Sailing from one region's level into another keeps the
// level the page started with; the lake-wide levels answer there. A later swap would: fetch the other level's manifest
// (fetchLevel), stream composeLevel(...)'s height and cover grids into the bay's slot (render/terrain.js swapOne: let a grid of
// another `region` replace a finer one), point render/ground.js's layer 0 at regionPhotoLevel(...) on a fresh photo texture, and
// reload the living lake's shore grids (shoreManifest). A home-card pick of another level's birthplace reloads the page instead
// (main.js), so every level a page holds is its start's.
// Plain JS, no DOM: main.js, the Vite config, the tests.
import { regionsOf, birthplaceRows } from '../sim/regions.js';

// the rows that declare a level: [{ id (the region's), dir, full, phone, photo }]
export const regionLevels = (waters) => regionsOf(waters).filter((r) => r.level).map((r) => Object.freeze({ id: r.id, ...r.level }));
// a region's level, or null (no row, or no level: the bay's)
export const levelOfRegion = (waters, regionId) => regionLevels(waters).find((l) => l.id === regionId) ?? null;
// a birthplace's region's level, or null
export function levelOfBirth(waters, birthId) {
  const row = birthplaceRows(waters).find((b) => b.id === birthId);
  return row ? levelOfRegion(waters, row.region) : null;
}
// the level key a birthplace starts on: its region's id when that region has a level, else 'bay'
export const levelKeyOfBirth = (waters, birthId) => levelOfBirth(waters, birthId)?.id ?? 'bay';

// The level a page starts on. birth: resolveStart's answer ({ id, source }) or null (a URL pose: ?start= / ?heading=); race: the
// page opens in Regatta (its own start in the bay); show: the fireworks evening takes the start (main.js showStart: the show's own
// start in the bay over a remembered birthplace). → the region's level, or null (the bay's)
export function startRegionLevel({ waters, birth, race = false, show = false } = {}) {
  if (!birth || race || show) return null;
  return levelOfBirth(waters, birth.id);
}

// the manifest a variant reads and the files it names, relative to the terrain's folder
export const manifestFile = (level, variant) => `${level.dir}/${variant === 'phone' ? level.phone : level.full}`;
export const photoManifestFile = (level) => `${level.dir}/${level.photo}`;

// a region manifest's one level as a level of the lake's: in the bay's slot, its files under the region's folder
export function composeLevel(level, manifest) {
  const L = manifest.levels[0], f = (n) => (n ? `${level.dir}/${n}` : n);
  return Object.freeze({ ...L, slot: 'bay', region: level.id, height: f(L.height), distance: f(L.distance), cover: f(L.cover) });
}
// the living lake's shore manifest: the lake's levels with the region's level in the bay's place (v2/sim/lake.js loadShore)
export const shoreManifest = (lake, composed) => Object.freeze({ ...lake, levels: lake.levels.map((L) => (L.name === composed.slot ? composed : L)) });

// the region's photo level for render/ground.js (layer 0, in the bay's place): v2/terrain/photo.js's level shape, its tiles under
// `base` (relative to the page) as <base><set>/<name>/<tx>-<ty>.webp
export function regionPhotoLevel(level, photoManifest, variant, terrainDir = 'terrain') {
  const set = variant === 'phone' ? 'phone' : 'full';
  const [name, P] = Object.entries(photoManifest.sets[set].levels)[0];
  const dir = photoManifestFile(level).split('/').slice(0, -1).join('/');
  return Object.freeze({ name, texel: P.texel, file: P.file, w: P.w, h: P.h, x0: P.x0, z0: P.z0, x1: P.x0 + P.w * P.texel, z1: P.z0 + P.h * P.texel, base: `${terrainDir}/${dir}/` });
}

// fetch a region's level for a variant: → { level, manifest, photo, composed, photoLevel } (fetchFn(url) → Response)
export async function fetchLevel(level, variant, base, fetchFn = globalThis.fetch, terrainDir = 'terrain') {
  const get = async (f) => { const r = await fetchFn(new URL(f, base)); if (!r.ok) throw new Error(`region level ${f}: ${r.status}`); return r.json(); };
  const [manifest, photo] = await Promise.all([get(manifestFile(level, variant)), get(photoManifestFile(level))]);
  const composed = composeLevel(level, manifest);
  return { level, manifest, photo, composed, photoLevel: regionPhotoLevel(level, photo, variant, terrainDir) };
}

// every file of a region's level, relative to the terrain's folder (both sets: the manifests, the heights, shore and cover grids,
// the photo tiles): what a build ships and the dev server serves (v2/vite.config.js). readJson(path under the terrain folder)
export function levelFiles(level, readJson) {
  const out = new Set([manifestFile(level, 'full'), manifestFile(level, 'phone'), photoManifestFile(level)]);
  for (const v of ['full', 'phone']) for (const L of readJson(manifestFile(level, v)).levels) for (const f of [L.height, L.distance, L.cover]) if (f) out.add(`${level.dir}/${f}`);
  const photo = readJson(photoManifestFile(level)), pdir = photoManifestFile(level).split('/').slice(0, -1).join('/');
  for (const [set, S] of Object.entries(photo.sets)) for (const [name, P] of Object.entries(S.levels)) for (const t of Object.keys(P.files)) out.add(`${pdir}/${set}/${name}/${t}.webp`);
  return [...out].sort();
}

// The files a start fetches from the terrain's levels and the ground photo, as paths from the page (terrain/…, photo/…): the stream
// plan's grids for the variant, the living lake's shore grids, the photo tiles of the bay's (or the region's) layer and the
// lake-wide layer, and the region's two manifests. lake: { full, phone } (the lake's manifests); region: fetchLevel's answer or
// null; photoSets: v2/terrain/photo.js PHOTO_SETS; tilesOf, tileUrl, streamPlan, shoreFiles: passed in (no imports of the GPU side).
export function startFiles({ lake, variant, region = null, photoSets, tilesOf, tileUrl, streamPlan, shoreFiles, terrainDir = 'terrain' }) {
  const t = (f) => `${terrainDir}/${f}`;
  const grids = streamPlan(lake.full, lake.phone, variant, region?.composed ?? null).flat().map((g) => t(g.file));
  const shore = shoreFiles(region ? shoreManifest(lake.full, region.composed) : lake.full).map(t);
  const set = { ...photoSets[variant], ...(region ? { bay: region.photoLevel } : {}) };
  const tiles = Object.values(set).flatMap((L) => tilesOf(L).map((tt) => tileUrl(variant, L, tt)));
  const manifests = region ? [t(manifestFile(region.level, variant)), t(photoManifestFile(region.level))] : [];
  return [...new Set([...manifests, ...grids, ...shore, ...tiles])].sort();
}
