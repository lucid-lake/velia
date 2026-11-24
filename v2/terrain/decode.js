// The terrain grids' decoder (.lsh, tools/terrain/build_tahoe.py): gzip of a uint16 grid, 2-D predicted (left + up −
// up-left, mod 2^16), the hi-byte plane then the lo-byte plane; cover grids are plain gzip'd uint8 class ids. The maths
// is a copy of src/sim/terrain-data.js's `unpredict` and `inflate` (not exported there; that module also owns v1's
// fetch, worker priming and variant logic, which v2 does differently): v2/notes/engine.md § Shared modules. The test
// (v2/tests/terrain-data.test.mjs) decodes the same files both ways and demands identical arrays.
// Plain JS, no DOM: the terrain worker (v2/terrain/worker.js) and node tests use it.

// DecompressionStream: every WebGPU browser and node ≥ 18 have it (no node:zlib fallback: v2 has no bare imports)
export async function inflate(bytes) {
  const ds = new DecompressionStream('gzip');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

// the 2-D prediction undone: p holds w·h hi bytes then w·h lo bytes
export function unpredict(p, w, h) {
  const n = w * h, q = new Uint16Array(n);
  if (p.length < 2 * n) throw new Error(`terrain: ${p.length} bytes for a ${w}×${h} grid`);
  for (let j = 0, k = 0; j < h; j++) {
    for (let i = 0; i < w; i++, k++) {
      const r = (p[k] << 8) | p[n + k];
      const left = i ? q[k - 1] : 0, up = j ? q[k - w] : 0, ul = i && j ? q[k - w - 1] : 0;
      q[k] = (r + (j && i ? left + up - ul : j ? up : left)) & 0xffff;
    }
  }
  return q;
}

// a height grid's raw codes → metres above the lake surface: offset + step · code (the manifest's height block)
export const metres = (code, H) => H.offset + H.step * code;

// The min/max of a height grid over the world-aligned cells of the quadtree's bound grid (v2/terrain/quadtree.js):
// cells of `cell` m from (ox, oz). Returns the covered cell rectangle and its [min, max] pairs in metres. Bilinear
// samples and the level blend are convex combinations of texels, so the union of every level's min/max over a cell
// bounds any height the sampler can return there.
export function cellBounds(q, L, H, { ox, oz, cell }) {
  const cx0 = Math.floor((L.x0 - ox) / cell), cz0 = Math.floor((L.z0 - oz) / cell);
  const cx1 = Math.floor((L.x0 + (L.w - 1) * L.step - ox) / cell), cz1 = Math.floor((L.z0 + (L.h - 1) * L.step - oz) / cell);
  const cw = cx1 - cx0 + 1, ch = cz1 - cz0 + 1;
  const mm = new Float32Array(cw * ch * 2);
  for (let k = 0; k < cw * ch; k++) { mm[2 * k] = Infinity; mm[2 * k + 1] = -Infinity; }
  // the cell index of every column and row once (a texel's cell is a pure function of its column or row)
  const ci = new Int32Array(L.w), cj = new Int32Array(L.h);
  for (let i = 0; i < L.w; i++) ci[i] = Math.floor((L.x0 + i * L.step - ox) / cell) - cx0;
  for (let j = 0; j < L.h; j++) cj[j] = Math.floor((L.z0 + j * L.step - oz) / cell) - cz0;
  for (let j = 0, k = 0; j < L.h; j++) {
    const row = cj[j] * cw;
    for (let i = 0; i < L.w; i++, k++) {
      const c = 2 * (row + ci[i]), v = q[k];
      if (v < mm[c]) mm[c] = v;
      if (v > mm[c + 1]) mm[c + 1] = v;
    }
  }
  for (let k = 0; k < mm.length; k++) mm[k] = Number.isFinite(mm[k]) ? metres(mm[k], H) : mm[k];
  return { cx0, cz0, cw, ch, mm };
}
