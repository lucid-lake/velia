// The boat models' worker (M3b): fetch the packed GLBs (tools/v2-boat-pack.mjs; gzip undone here unless the host already
// did), parse them (engine/gltf.js), build v1's boat (boat/models.js: the placements, materials, LOD sets, the merged
// vertex set), and decode the images into texture layers with their mips (createImageBitmap, resized per level). All of it
// off the main thread; the arrays and bitmaps come back transferred. The page uploads them a slice a frame.
//   post { urls: { hull, cockpit, hardware, wheel }, hull: { freeboard, anchorPin, throttle, loa, lwl, beam, transomZ }, canvas: { canvas, trim }, texSize }
//   → { set, bitmaps: [[ImageBitmap per mip] per image], wireBytes, files, buildMs, decodeMs } | { error }
import { parseGlb, gunzipMaybe, imageBytes } from '../../engine/gltf.js';
import { buildBoatModels } from './models.js';

async function levels(bytes, mime, [w, h]) {
  const src = await createImageBitmap(new Blob([bytes], { type: mime }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const out = [];
  for (let lw = w, lh = h; ; lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1)) {
    out.push(await createImageBitmap(src, { resizeWidth: lw, resizeHeight: lh, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
    if (lw === 1 && lh === 1) break;
  }
  src.close();
  return out;
}

self.onmessage = async (e) => {
  const { urls, hull, canvas, texSize } = e.data;
  try {
    const t0 = performance.now();
    let wireBytes = 0;
    const names = Object.keys(urls);
    const glbs = Object.fromEntries(await Promise.all(names.map(async (n) => {
      const r = await fetch(urls[n]);
      if (!r.ok) throw new Error(`${urls[n]}: ${r.status}`);
      const raw = new Uint8Array(await r.arrayBuffer());
      wireBytes += raw.byteLength;
      return [n, parseGlb(await gunzipMaybe(raw))];
    })));
    const t1 = performance.now();
    const set = buildBoatModels(glbs, { dims: { HULL: hull }, canvas });
    const t2 = performance.now();
    const bitmaps = await Promise.all(set.images.map((im) => { const b = imageBytes(glbs[im.file], im.image); return levels(b.bytes, b.mime, texSize); }));
    const t3 = performance.now();
    delete set.records;
    const transfer = [set.position.buffer, set.normal.buffer, set.uv.buffer, set.color.buffer, set.mat.buffer, set.index.buffer, set.materials.buffer, ...bitmaps.flat()];
    self.postMessage({ set, bitmaps, wireBytes, files: names.length, fetchMs: t1 - t0, buildMs: t2 - t1, decodeMs: t3 - t2 }, transfer);
  } catch (err) {
    self.postMessage({ error: String(err?.message ?? err) });
  }
};
