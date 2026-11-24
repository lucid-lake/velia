// The terrain's mesh LOD: CDLOD (Strugar 2009, "Continuous Distance-Dependent Level of Detail for Rendering Heightmaps"),
// written from the paper. A quadtree over a 131 072 m square centred on the island (the data reach ±49.1 km); its leaf
// is 128 m. Every node is drawn with the same 64 × 64-cell grid, so a level-l node's cell is 2 · 2^l m (2 m at the
// leaf, the bay's lidar). The CPU picks nodes per frame by distance (level l covers out to RANGE0 · 2^l from the eye)
// and the frustum; the GPU builds every vertex: one static 33 × 33 patch (a node's quadrant) drawn instanced, each
// instance (x0, z0, level, cell) read from a storage buffer, its height sampled from the grids in the vertex shader, and
// the far 14 % of a level's range morphed onto the next level's grid (odd vertices slide onto even ones), so levels meet
// without cracks or pops. Distances are horizontal (xz), in the selection and in the morph alike: a shared edge between
// a level-l and a level-(l+1) quadrant then lies between R_l (the coarse quadrant was not refined: its box is past R_l)
// and R_l + √2·S_l (inside the fine node, whose box reached R_l), so the fine side is fully morphed there and the coarse
// side not at all when morph·R_(l+1) ≥ R_l + √2·S_l: with R_l = 2·S_l, morph ≥ 0.854 (0.86; quadtree.test.mjs checks
// the invariant on real selections). With 3D distances a tall box (a 300 m face in a 128 m node) breaks that bound. Nothing here allocates per frame: the selection writes into one Float32Array.
//
// The heights' bounds per node come from a 512 × 512 grid of 256 m cells (decode.js cellBounds, merged as grids land,
// dilated by a cell so a bilinear sample across a cell edge stays inside) and its min/max pyramid: the boxes for the
// frustum test and the distance test. Cells with no data stay empty and their nodes are skipped (past the ring); so are
// nodes wholly deeper than floorCut (60 m under the surface): the water draws its own opaque body there (render/water.js),
// so the deep lake floor, most of Tahoe's 490 km², costs nothing.
// range0 256 m: a cell is 1/128 to 1/64 rad from the eye (≈ 7–14 px at 1280 × 720, 50°): tiny triangles cost several
// fragment invocations a pixel under MSAA 4 (512 m drew ≈ 1 triangle a pixel and cost 4× the scene pass).
export const TREE = Object.freeze({ origin: -65536, size: 131072, levels: 11, leaf: 128, N: 64, cell: 256, cells: 512, range0: 256, morph: 0.86, maxInstances: 4096, floorCut: -60 });
export const PATCH = TREE.N / 2;   // a quadrant: 32 × 32 cells, 33 × 33 vertices, 2048 triangles

export const nodeSize = (l) => TREE.leaf * 2 ** l;
export const cellOf = (l) => nodeSize(l) / TREE.N;
export const rangeOf = (l, range0 = TREE.range0) => range0 * 2 ** l;

// --- the bounds grid and its pyramid ---
export function createBounds(T = TREE) {
  const n = T.cells, P = Math.log2(n) + 1;
  const raw = new Float32Array(n * n * 2);   // the union of every grid's min/max per cell (before the dilation)
  for (let k = 0; k < n * n; k++) { raw[2 * k] = Infinity; raw[2 * k + 1] = -Infinity; }
  const pyr = Array.from({ length: P }, (_, p) => { const m = n >> p, a = new Float32Array(m * m * 2); for (let k = 0; k < m * m; k++) { a[2 * k] = Infinity; a[2 * k + 1] = -Infinity; } return a; });

  // merge one grid's cell bounds ({ cx0, cz0, cw, ch, mm }, cells of T.cell m from T.origin), then refresh the dilated
  // base and the pyramid over the touched rectangle only
  function merge({ cx0, cz0, cw, ch, mm }) {
    let x0 = n, z0 = n, x1 = -1, z1 = -1;
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const cx = cx0 + i, cz = cz0 + j;
      if (cx < 0 || cz < 0 || cx >= n || cz >= n) continue;
      const s = 2 * (j * cw + i), d = 2 * (cz * n + cx);
      if (!(mm[s] <= mm[s + 1])) continue;
      if (mm[s] < raw[d]) raw[d] = mm[s];
      if (mm[s + 1] > raw[d + 1]) raw[d + 1] = mm[s + 1];
      if (cx < x0) x0 = cx; if (cz < z0) z0 = cz; if (cx > x1) x1 = cx; if (cz > z1) z1 = cz;
    }
    if (x1 < 0) return;
    // the dilated base: each cell's bounds hold its 8 neighbours' (a bilinear sample in a cell may read a texel of the next)
    const ax = Math.max(0, x0 - 1), az = Math.max(0, z0 - 1), bx = Math.min(n - 1, x1 + 1), bz = Math.min(n - 1, z1 + 1);
    const base = pyr[0];
    for (let cz = az; cz <= bz; cz++) for (let cx = ax; cx <= bx; cx++) {
      let lo = Infinity, hi = -Infinity;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= n || z >= n) continue;
        const k = 2 * (z * n + x); if (raw[k] < lo) lo = raw[k]; if (raw[k + 1] > hi) hi = raw[k + 1];
      }
      const d = 2 * (cz * n + cx); base[d] = lo; base[d + 1] = hi;
    }
    let rx0 = ax, rz0 = az, rx1 = bx, rz1 = bz;
    for (let p = 1; p < P; p++) {
      const m = n >> p, src = pyr[p - 1], dst = pyr[p], ms = m * 2;
      rx0 >>= 1; rz0 >>= 1; rx1 >>= 1; rz1 >>= 1;
      for (let cz = rz0; cz <= rz1; cz++) for (let cx = rx0; cx <= rx1; cx++) {
        let lo = Infinity, hi = -Infinity;
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) { const k = 2 * ((2 * cz + dz) * ms + 2 * cx + dx); if (src[k] < lo) lo = src[k]; if (src[k + 1] > hi) hi = src[k + 1]; }
        const d = 2 * (cz * m + cx); dst[d] = lo; dst[d + 1] = hi;
      }
    }
  }
  // the bounds of node (ix, iz) at level l into out[0..1] (min, max; min > max when empty)
  function node(l, ix, iz, out) {
    let p = l - 1, x = ix, z = iz;
    if (l === 0) { p = 0; x = ix >> 1; z = iz >> 1; }
    const m = n >> p, k = 2 * (z * m + x), a = pyr[p];
    out[0] = a[k]; out[1] = a[k + 1];
    return out;
  }
  return { merge, node, pyramid: pyr, raw };
}

// --- the frustum: 5 planes (left, right, bottom, top, near) from a column-major viewProj; reversed or plain z ---
export function frustumPlanes(vp, out = new Float64Array(20)) {
  const row = (r, k) => vp[k * 4 + r];
  const set = (i, s0, r0, s1) => {   // plane = row3 + s0 · row r0 (s1 unused: the near plane is row3 − row2 under reversed z)
    let a = row(3, 0) + s0 * row(r0, 0), b = row(3, 1) + s0 * row(r0, 1), c = row(3, 2) + s0 * row(r0, 2), d = row(3, 3) + s0 * row(r0, 3);
    const l = Math.hypot(a, b, c) || 1; out[i * 4] = a / l; out[i * 4 + 1] = b / l; out[i * 4 + 2] = c / l; out[i * 4 + 3] = d / l;
  };
  set(0, 1, 0); set(1, -1, 0); set(2, 1, 1); set(3, -1, 1); set(4, -1, 2);
  return out;
}
export function boxInFrustum(pl, x0, y0, z0, x1, y1, z1) {
  for (let i = 0; i < 5; i++) {
    const a = pl[i * 4], b = pl[i * 4 + 1], c = pl[i * 4 + 2], d = pl[i * 4 + 3];
    if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? y1 : y0) + c * (c > 0 ? z1 : z0) + d < 0) return false;
  }
  return true;
}

// --- the selection ---
// createSelector(bounds) → { select(eye, planes) → count; inst (Float32Array, 4 floats an instance: x0, z0, level,
// cell); count; overflow; levels (per-level instance counts) }
export function createSelector(bounds, { T = TREE, range0 = T.range0, maxInstances = T.maxInstances, floorCut = T.floorCut } = {}) {
  const inst = new Float32Array(maxInstances * 4);
  const R2 = new Float64Array(T.levels); for (let l = 0; l < T.levels; l++) R2[l] = rangeOf(l, range0) ** 2;
  const perLevel = new Int32Array(T.levels);
  const bb = new Float64Array(2), cb = new Float64Array(2);
  let count = 0, overflow = 0, ex = 0, ey = 0, ez = 0, pl = null;

  // the horizontal distance from the eye to a box (the LOD is by xz distance, as the vertex shader's morph: see below)
  const dist2 = (x0, z0, x1, z1) => {
    const dx = ex < x0 ? x0 - ex : ex > x1 ? ex - x1 : 0, dz = ez < z0 ? z0 - ez : ez > z1 ? ez - z1 : 0;
    return dx * dx + dz * dz;
  };
  // one quadrant (a, b ∈ {0, 1}) of node (ix, iz) at level l, at that level's cell
  function quadrant(l, ix, iz, a, b) {
    const S = nodeSize(l), h = S / 2, x0 = T.origin + ix * S + a * h, z0 = T.origin + iz * S + b * h;
    let lo, hi;
    if (l > 0) { bounds.node(l - 1, 2 * ix + a, 2 * iz + b, cb); lo = cb[0]; hi = cb[1]; } else { bounds.node(0, ix, iz, cb); lo = cb[0]; hi = cb[1]; }
    if (!(lo <= hi) || hi < floorCut) return;
    if (!boxInFrustum(pl, x0, lo, z0, x0 + h, hi, z0 + h)) return;
    if (count >= maxInstances) { overflow++; return; }
    const o = count * 4; inst[o] = x0; inst[o + 1] = z0; inst[o + 2] = l; inst[o + 3] = cellOf(l);
    count++; perLevel[l]++;
  }
  function whole(l, ix, iz) { for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) quadrant(l, ix, iz, a, b); }
  function visit(l, ix, iz) {
    bounds.node(l, ix, iz, bb);
    const lo = bb[0], hi = bb[1];
    if (!(lo <= hi) || hi < floorCut) return true;   // no data here, or all of it under the opaque deep water: nothing to draw
    const S = nodeSize(l), x0 = T.origin + ix * S, z0 = T.origin + iz * S;
    const d2 = dist2(x0, z0, x0 + S, z0 + S);
    if (d2 > R2[l]) return false;   // past this level's range: the parent draws the area
    if (!boxInFrustum(pl, x0, lo, z0, x0 + S, hi, z0 + S)) return true;
    if (l === 0 || d2 > R2[l - 1]) { whole(l, ix, iz); return true; }
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      if (!visit(l - 1, 2 * ix + a, 2 * iz + b)) quadrant(l, ix, iz, a, b);
    }
    return true;
  }
  return {
    inst, get count() { return count; }, get overflow() { return overflow; }, perLevel,
    select(eye, planes) {
      count = 0; overflow = 0; perLevel.fill(0); ex = eye[0]; ey = eye[1]; ez = eye[2]; pl = planes;
      const top = T.levels - 1;
      if (!visit(top, 0, 0)) whole(top, 0, 0);
      return count;
    },
  };
}
