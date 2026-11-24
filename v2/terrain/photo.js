// The ground photo as tiles (M5c): v1's NAIP albedo (src/naip-layout.js: the bay's 5.6 × 3.6 km box at 2 m, the region's
// whole lake and rim at 32 m; on a phone 4 m and 64 m) cut into 256² WebP tiles (tools/v2-photo-tiles.mjs → v2/photo/),
// streamed after the first frame nearest the eye first and uploaded into one array texture (a layer a level; render/
// ground.js); the bake's class albedo stays the base until a tile lands and past the photo's edges. Plain JS, no DOM:
// the tool, render/ground.js and the tests. Row 0 of every image is the north edge (z0), as v1's.
import { NAIP_EXTENT, NAIP_FILES } from '../../src/naip-layout.js';

export const TILE = 256;
const level = (name, texel) => { const [file, w, h] = NAIP_FILES[name][texel], E = NAIP_EXTENT[name]; return Object.freeze({ name, texel, file, w, h, x0: E.x0, z0: E.z0, x1: E.x1, z1: E.z1 }); };
// the sets: full (desktop) and phone; the bay is layer 0, the region layer 1 of the array texture
export const PHOTO_SETS = Object.freeze({
  full: Object.freeze({ bay: level('bay', 2), region: level('region', 32) }),
  phone: Object.freeze({ bay: level('bay', 4), region: level('region', 64) }),
});
export const LAYER = Object.freeze({ bay: 0, region: 1 });
export const BUDGET_BYTES = 4 * 1048576;   // the full set's tiles, in all (the deliverable: about 3–4 MB)

// a level's tiles: pixel origin and size (the last column and row may be partial), tile index, world box
export function tilesOf(L, tile = TILE) {
  const out = [];
  const cols = Math.ceil(L.w / tile), rows = Math.ceil(L.h / tile);
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const px = tx * tile, py = ty * tile, w = Math.min(tile, L.w - px), h = Math.min(tile, L.h - py);
    out.push({ tx, ty, px, py, w, h, x0: L.x0 + px * L.texel, z0: L.z0 + py * L.texel, x1: L.x0 + (px + w) * L.texel, z1: L.z0 + (py + h) * L.texel });
  }
  return out;
}
export const tileFile = (set, levelName, tx, ty) => `${set}/${levelName}/${tx}-${ty}.webp`;
// the array texture's size for a set: the larger of its levels in each axis
export function textureSize(set) { const Ls = Object.values(set); return [Math.max(...Ls.map((L) => L.w)), Math.max(...Ls.map((L) => L.h))]; }

// the squared distance from a point to a tile's box (0 inside)
export function tileDist2(t, x, z) {
  const dx = x < t.x0 ? t.x0 - x : x > t.x1 ? x - t.x1 : 0, dz = z < t.z0 ? t.z0 - z : z > t.z1 ? z - t.z1 : 0;
  return dx * dx + dz * dz;
}
// the stream order for a set from the eye's spot: the bay's tiles nearest first (the ground the camera stands on), then
// the region's nearest first (the far shores: coarse, and each covers 8 km); ties by index, so the order is deterministic
export function streamOrder(set, x, z, tile = TILE) {
  const out = [];
  for (const levelName of ['bay', 'region']) {
    const L = set[levelName]; if (!L) continue;
    const ts = tilesOf(L, tile).map((t, i) => ({ ...t, level: levelName, layer: LAYER[levelName], i, d2: tileDist2(t, x, z) }));
    ts.sort((a, b) => a.d2 - b.d2 || a.i - b.i);
    out.push(...ts);
  }
  return out;
}
// the tiles a camera at (x, z) needs first: within reach m of it (the bay) plus every region tile (the far shores); the
// rest of the bay follows (a live page streams them all; this is the order's head the first frames wait on)
export function nearTiles(order, x, z, reach = 1500) { return order.filter((t) => t.level !== 'bay' || tileDist2(t, x, z) <= reach * reach); }
