// M5c: v1's ground photo (terrain/naip/albedo-*.webp: USDA NAIP 2022, de-lit and graded by tools/ground/build_naip.py;
// public domain) cut into 256² WebP tiles for v2's streamed ground (v2/terrain/photo.js): the full set (the bay at 2 m,
// the region at 32 m) and the phone set (the bay at 4 m, the region at 64 m). Chrome decodes and encodes (no image
// codec in node, no new dependency): one headless page, canvas → WebP at QUALITY. Writes v2/photo/<set>/<level>/<tx>-<ty>.webp
// and v2/photo/manifest.json (every level's size, tile grid and bytes; the alpha range, which the shader reads as the
// landed flag and the bay's class index). v1's files are untouched.
//   node tools/v2-photo-tiles.mjs [--quality 0.84] [--check]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTO_SETS, TILE, tilesOf, tileFile } from '../v2/terrain/photo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const QUALITY = parseFloat(opt('quality') ?? '0.84');
const CHECK = opt('check') === true;
const OUT = resolve(ROOT, 'v2/photo');
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) { console.error(`Chrome not found at ${CHROME}; set LAKESHORE_CHROME`); process.exit(2); }

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const manifest = { source: 'USDA FSA NAIP 2022 (public domain) via v1 terrain/naip/*.webp (tools/ground/build_naip.py); cut by tools/v2-photo-tiles.mjs', tile: TILE, quality: QUALITY, sets: {} };
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  for (const [setName, set] of Object.entries(PHOTO_SETS)) {
    manifest.sets[setName] = { levels: {} };
    for (const [levelName, L] of Object.entries(set)) {
      const src = resolve(ROOT, 'terrain/naip', L.file);
      const b64 = readFileSync(src).toString('base64');
      const tiles = tilesOf(L);
      // decode once; cut and encode every tile in the page (canvas → WebP blob → bytes)
      const res = await page.evaluate(async ({ b64, tiles, quality, tile }) => {
        const r = await fetch(`data:image/webp;base64,${b64}`); const blob = await r.blob();
        const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const out = [];
        let aMin = 255, aMax = 0;
        const big = new OffscreenCanvas(bmp.width, bmp.height), bctx = big.getContext('2d', { willReadFrequently: true });
        bctx.drawImage(bmp, 0, 0);
        const full = bctx.getImageData(0, 0, bmp.width, bmp.height).data;
        for (let i = 3; i < full.length; i += 4) { if (full[i] < aMin) aMin = full[i]; if (full[i] > aMax) aMax = full[i]; }
        for (const t of tiles) {
          const cv = new OffscreenCanvas(t.w, t.h), ctx = cv.getContext('2d');
          ctx.drawImage(bmp, t.px, t.py, t.w, t.h, 0, 0, t.w, t.h);
          const wb = await cv.convertToBlob({ type: 'image/webp', quality });
          const ab = await wb.arrayBuffer();
          out.push({ tx: t.tx, ty: t.ty, bytes: Array.from(new Uint8Array(ab)) });
        }
        return { w: bmp.width, h: bmp.height, aMin, aMax, out };
      }, { b64, tiles, quality: QUALITY, tile: TILE });
      if (res.w !== L.w || res.h !== L.h) throw new Error(`${L.file}: ${res.w}×${res.h}, the layout says ${L.w}×${L.h}`);
      const dir = resolve(OUT, setName, levelName);
      if (!CHECK) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
      let bytes = 0;
      const files = {};
      for (const t of res.out) {
        const f = tileFile(setName, levelName, t.tx, t.ty);
        const p = resolve(OUT, f);
        if (CHECK) { if (!existsSync(p)) throw new Error(`missing ${f}`); bytes += statSync(p).size; files[`${t.tx}-${t.ty}`] = statSync(p).size; continue; }
        writeFileSync(p, Buffer.from(t.bytes)); bytes += t.bytes.length; files[`${t.tx}-${t.ty}`] = t.bytes.length;
      }
      manifest.sets[setName].levels[levelName] = { file: L.file, texel: L.texel, w: L.w, h: L.h, x0: L.x0, z0: L.z0, cols: tiles.reduce((m, t) => Math.max(m, t.tx + 1), 0), rows: tiles.reduce((m, t) => Math.max(m, t.ty + 1), 0), tiles: tiles.length, bytes, alpha: [res.aMin, res.aMax], files };
      console.log(`${setName}/${levelName}: ${L.w}×${L.h} @ ${L.texel} m → ${tiles.length} tiles, ${(bytes / 1024).toFixed(0)} kB (alpha ${res.aMin}–${res.aMax})`);
    }
  }
  for (const [n, s] of Object.entries(manifest.sets)) { s.bytes = Object.values(s.levels).reduce((a, L) => a + L.bytes, 0); console.log(`${n} set: ${(s.bytes / 1048576).toFixed(2)} MB`); }
  if (!CHECK) writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
} finally {
  await browser.close();
}
