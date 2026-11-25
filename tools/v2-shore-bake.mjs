// #56 M3: bake the shore field (v2/sim/shoreField.js bakeShore: Ultra-Water's eikonal travel time from v1's heights, MIT)
// into v2/assets/shore/shore.vsf.gz. Deterministic: the same grids give the same bytes (gzip level 9, no timestamp); the
// tests re-bake a box and compare. Run it again after any change to the bed (tools/terrain/build_tahoe.py).
//   node tools/v2-shore-bake.mjs [--out v2/assets/shore/shore.vsf.gz] [--check]   --check: re-bake and compare, write nothing
//   node tools/v2-shore-bake.mjs --png renders/ultra-m3/field.png                  a picture of the field (τ bands, the kept tiles)
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadTerrain, makeSampler } from '../src/sim/terrain-data.js';
import { bakeShore, encodeShore, decodeShore, SHORE_BAKE, TILE_TEXELS } from '../v2/sim/shoreField.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1] ?? true; };
const OUT = resolve(ROOT, arg('--out') ?? 'v2/assets/shore/shore.vsf.gz');

const t0 = Date.now();
const S = makeSampler(await loadTerrain('full'));
const field = bakeShore({ heightAt: (x, z) => S.height(x, z), log: (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s  ${m}`) });
const raw = encodeShore(field);
const gz = gzipSync(raw, { level: 9 });
const H = field.head;
const sha = createHash('sha256').update(raw).digest('hex').slice(0, 16);
console.log(`tiles ${H.nTiles} of ${H.tilesX * H.tilesZ} (${(H.nTiles * TILE_TEXELS * 4 / 1e6).toFixed(2)} km² of 2 m texels), emitters ${H.nEmit}, raw ${raw.length} B, gzip ${gz.length} B, sha ${sha}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

if (arg('--check')) {
  const old = gunzipSync(readFileSync(OUT));
  const same = old.length === raw.length && old.every((v, i) => v === raw[i]);
  console.log(same ? 'check: the committed field is this bake, byte for byte' : 'check: DIFFERS from the committed field');
  process.exit(same ? 0 : 1);
}
const png = arg('--png');
if (png) {
  const { PNG } = await import('pngjs');
  const { w, h, tauHi, height } = field.grid, sc = 2, W = Math.ceil(w / sc), Hh = Math.ceil(h / sc);
  const img = new PNG({ width: W, height: Hh });
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const k = (j * sc) * w + i * sc, o = (j * W + i) * 4, hh = height[k], t = tauHi[k];
    const I = (i * sc) >> 4, J = (j * sc) >> 4, kept = field.index[J * H.tilesX + I] > 0;
    const band = hh <= 0 ? 0.5 + 0.5 * Math.cos(t * 2 * Math.PI / 2.5) : 0;
    img.data[o] = hh > 0 ? 90 : 20 + 60 * band; img.data[o + 1] = hh > 0 ? 80 : 40 + 120 * band * (kept ? 1 : 0.3); img.data[o + 2] = hh > 0 ? 60 : 80 + 100 * band; img.data[o + 3] = 255;
  }
  mkdirSync(dirname(resolve(ROOT, png)), { recursive: true });
  writeFileSync(resolve(ROOT, png), PNG.sync.write(img));
  console.log(`picture ${png}`);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, gz);
// the round trip
const back = decodeShore(gunzipSync(gz));
if (back.head.nTiles !== H.nTiles || back.tau1.some((v, i) => v !== field.tau1[i])) throw new Error('shore: the round trip differs');
console.log(`wrote ${OUT} (box ${SHORE_BAKE.x0}…${SHORE_BAKE.x0 + SHORE_BAKE.w * SHORE_BAKE.texel} × ${SHORE_BAKE.z0}…${SHORE_BAKE.z0 + SHORE_BAKE.h * SHORE_BAKE.texel} m)`);
