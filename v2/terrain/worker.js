// The terrain worker: fetch a grid, inflate it, undo the prediction, bound it per quadtree cell, and hand the codes back
// (transferred, no copy). Everything that costs milliseconds happens here, never in a frame (bay-h's 5 M texels take
// ≈ 30 ms to unpredict). The page uploads what comes back a slice a frame (v2/render/terrain.js).
//   post { id, url, buf (optional: the file's bytes, fetched by the page), grid: { kind, w, h, x0, z0, step }, H: { offset, step }, cells: { ox, oz, cell } }
//   → { id, codes (Uint16Array | Uint8Array), bytes (the file's size on the wire), ms, bounds } or { id, error }
import { inflate, unpredict, cellBounds } from './decode.js';

self.onmessage = async (e) => {
  const { id, url, buf, grid, H, cells } = e.data;
  try {
    const t = performance.now();
    let raw;
    if (buf) raw = new Uint8Array(buf);   // the page fetched it early (v2/render/terrain.js prefetch)
    else { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); raw = new Uint8Array(await r.arrayBuffer()); }
    const p = await inflate(raw);
    if (grid.kind === 'c') {
      if (p.length < grid.w * grid.h) throw new Error(`${url}: ${p.length} bytes for ${grid.w}×${grid.h}`);
      const codes = p.length === grid.w * grid.h ? p : p.slice(0, grid.w * grid.h);
      self.postMessage({ id, codes, bytes: raw.length, ms: performance.now() - t, bounds: null }, [codes.buffer]);
      return;
    }
    const codes = unpredict(p, grid.w, grid.h);
    const bounds = cellBounds(codes, grid, H, cells);
    self.postMessage({ id, codes, bytes: raw.length, ms: performance.now() - t, bounds }, [codes.buffer, bounds.mm.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
