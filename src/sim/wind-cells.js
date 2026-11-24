// Gust cells (wow/gusts, 2026-11-05): the gusts a sailor sees coming. Plain JS, no three.js; src/wind.js reads it.
// The day's gust field (wind.js gustNoise) is smooth: its patches swell and fade over ≈ 20 s at the boat, so a gust
// never "hits". Real puffs are cells of faster air (a downdraft spreading on the water, a cat's paw) with a sharp
// leading edge downwind and a soft tail: you see the dark line 5–15 s ahead, then the boat heels hard as it lands.
//
// The cells live in the air's own frame (the field's advection), so they ride downwind at the real wind speed.
// That frame is cut into CELLS.cellM squares; each square holds at most one cell per CELLS.periodS cycle, its centre,
// size, strength and phase drawn from a hash of (square, cycle, seed): deterministic, no Math.random().
// A cell's life over its cycle: it spreads in over riseS (size 70 → 100 %), holds, fades over fadeS, then is gone
// until its square's next cycle. Its shape is an ellipse, long across the wind as a gust line is (acrossM × alongM),
// a ragged rim, and a sharp leading edge (frontM) against a soft trailing one (backM).
// The factor is 1 + gain × life × inside, divided by CELLS.mean (the cells' expected mean over the water), so the
// air between the cells is a little lighter (the lulls) and the day's level stays where it was set. wind.js multiplies
// it into the gust factor BEFORE the gust cap's limiter (gustShape): a cell on top of a gusty patch is still capped.
//
//   cellFactor(x, z, t, adv, dirDeg, seed[, opts])   → the factor at a world point (adv: the field's advection(t))
//   cellRaster(px, pz, sizePx, cell, t, adv, dirDeg, seed[, opts])   → the same at a texture's texel centres (fast)
//   cellsOption(v)                                   → a field's cells option: true → CELLS, {…} → overrides, else null

export const CELLS = {
  cellM: 300,            // m, the squares (in the air's frame); one cell at most per square per cycle
  periodS: 150,          // s, a square's cycle (scene time)
  active: 0.85,          // the share of cycles that hold a cell
  riseS: 14, holdS: 60, fadeS: 26,   // s, the cell's life inside its cycle (the rest of the cycle it is gone)
  alongM: [55, 95],      // m, the half-length along the wind (drawn per cell)
  acrossM: [100, 170],   // m, the half-width across it
  gain: [0.2, 0.38],     // the extra wind at the core (× 1 + gain)
  frontM: 9, backM: 45,  // m, the leading (downwind) edge's half-width; the trailing edge's
  mean: 1.047,           // the factor's mean over open water (tools: tests/wind-cells.test.mjs measures it)
};

const fade = (t) => t * t * (3 - 2 * t);
const smooth = (a, b, x) => fade(Math.min(1, Math.max(0, (x - a) / (b - a))));
function hash(i, j, k, seed, salt) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2246822519) + Math.imul(seed + salt * 7919, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2654435761);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// one cell's life 0..1 and its spread (size scale) at phase u (seconds into its cycle)
export function cellLife(u, o = CELLS) {
  if (u < 0) return 0;
  if (u < o.riseS) return fade(u / o.riseS);
  if (u < o.riseS + o.holdS) return 1;
  if (u < o.riseS + o.holdS + o.fadeS) return 1 - fade((u - o.riseS - o.holdS) / o.fadeS);
  return 0;
}

// the cell of square (i, j) alive at t, or null: { cx, cz (air frame), al, ac (m), lobe, gain × life, R (its reach, m) }
function liveCell(i, j, t, seed = 1, o = CELLS) {
  const S = o.cellM, ph = hash(i, j, 0, seed, 1) * o.periodS, k = Math.floor((t + ph) / o.periodS), u = t + ph - k * o.periodS;
  const life = cellLife(u, o);
  if (life <= 0 || hash(i, j, k, seed, 2) >= o.active) return null;
  const spread = 0.7 + 0.3 * Math.min(1, u / o.riseS);
  const al = (o.alongM[0] + (o.alongM[1] - o.alongM[0]) * hash(i, j, k, seed, 5)) * spread;
  const ac = (o.acrossM[0] + (o.acrossM[1] - o.acrossM[0]) * hash(i, j, k, seed, 6)) * spread;
  const gain = o.gain[0] + (o.gain[1] - o.gain[0]) * hash(i, j, k, seed, 8);
  return { cx: (i + 0.25 + 0.5 * hash(i, j, k, seed, 3)) * S, cz: (j + 0.25 + 0.5 * hash(i, j, k, seed, 4)) * S, al, ac,
    lobe: 6.283 * hash(i, j, k, seed, 7), amp: gain * life, R: 1.14 * Math.max(al, ac) + o.backM };
}

// a cell's extra wind (gain × life × inside) at (X, Z) in the air's frame; (ux, uz) the downwind unit. The rim: an
// ellipse with two slow lobes (ragged, not a drawn oval); the edge measured in metres along the ray from the centre,
// sharp downwind (frontM), soft upwind (backM), blended round the sides (no seam)
function cellAdd(C, X, Z, ux, uz, o = CELLS) {
  const dx = X - C.cx, dz = Z - C.cz;
  if (Math.abs(dx) > C.R || Math.abs(dz) > C.R) return 0;
  const a = dx * ux + dz * uz, c = -dx * uz + dz * ux;   // along (downwind +), across
  const d = Math.hypot(a, c);
  if (d > C.R) return 0;
  const q = Math.hypot(a / C.al, c / C.ac), th = Math.atan2(a / C.al, c / C.ac);
  const rim = 1 + 0.09 * Math.sin(3 * th + C.lobe) + 0.05 * Math.sin(5 * th - 0.4);
  const dr = q > 1e-9 ? d * (1 - rim / q) : -Infinity;   // m past the rim along the ray (negative inside)
  const w = o.backM + (o.frontM - o.backM) * smooth(-0.35, 0.35, d > 1e-9 ? a / d : 0);
  return C.amp * (1 - smooth(-w, w, dr));
}

const downwindOf = (dirDeg) => { const r = dirDeg * Math.PI / 180; return [-Math.sin(r), Math.cos(r)]; };

// the factor at (x, z), time t. adv: [ox, oz] how far the air has moved by t; dirDeg: the wind's FROM direction.
// Two cells overlapping: the stronger, not the sum. Only the 3 × 3 squares round the point can reach it (a cell's
// reach R ≤ 1.14 × 170 + 45 ≈ 240 m, under the 1.25 squares to the next ring)
export function cellFactor(x, z, t, adv, dirDeg, seed = 1, o = CELLS) {
  const X = x - adv[0], Z = z - adv[1], S = o.cellM, i0 = Math.floor(X / S), j0 = Math.floor(Z / S);
  const [ux, uz] = downwindOf(dirDeg);
  let add = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const C = liveCell(i0 + di, j0 + dj, t, seed, o);
    if (C) add = Math.max(add, cellAdd(C, X, Z, ux, uz, o));
  }
  return (1 + add) / o.mean;
}

// cellFactor at every point of a texture's texel centres (px, pz: Float64Arrays, row-major sizePx², cell m apart, as
// WindField.toTexture lays them out), into out (Float64Array): each live cell drawn into its own box of texels only.
// The same numbers as cellFactor at each point (the same cells, the same arithmetic).
export function cellRaster(px, pz, sizePx, cell, t, adv, dirDeg, seed = 1, o = CELLS, out = new Float64Array(px.length)) {
  const add = out.fill(0), [ux, uz] = downwindOf(dirDeg), S = o.cellM;
  const x0 = px[0], z0 = pz[0];   // the first texel's centre
  const X0 = x0 - adv[0], Z0 = z0 - adv[1], X1 = X0 + (sizePx - 1) * cell, Z1 = Z0 + (sizePx - 1) * cell;
  for (let j = Math.floor(Z0 / S) - 1; j <= Math.floor(Z1 / S) + 1; j++) for (let i = Math.floor(X0 / S) - 1; i <= Math.floor(X1 / S) + 1; i++) {
    const C = liveCell(i, j, t, seed, o);
    if (!C) continue;
    const ia = Math.max(0, Math.floor((C.cx + adv[0] - C.R - x0) / cell)), ib = Math.min(sizePx - 1, Math.ceil((C.cx + adv[0] + C.R - x0) / cell));
    const ja = Math.max(0, Math.floor((C.cz + adv[1] - C.R - z0) / cell)), jb = Math.min(sizePx - 1, Math.ceil((C.cz + adv[1] + C.R - z0) / cell));
    for (let q = ja; q <= jb; q++) for (let p = q * sizePx + ia, e = q * sizePx + ib; p <= e; p++) {
      // only the 3 × 3 squares round the texel count (as cellFactor)
      const X = px[p] - adv[0], Z = pz[p] - adv[1];
      if (Math.abs(Math.floor(X / S) - i) > 1 || Math.abs(Math.floor(Z / S) - j) > 1) continue;
      const v = cellAdd(C, X, Z, ux, uz, o);
      if (v > add[p]) add[p] = v;
    }
  }
  for (let p = 0; p < add.length; p++) add[p] = (1 + add[p]) / o.mean;
  return add;
}

// the field's cells option: true → CELLS, an object → CELLS with its overrides, else null (off)
export const cellsOption = (v) => (v === true ? CELLS : v && typeof v === 'object' ? { ...CELLS, ...v } : null);
