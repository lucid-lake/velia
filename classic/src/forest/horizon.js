// The terrain's skyline, for shadow masses: per texel the elevation angle of the horizon in 8 azimuths. A tree (or a
// slope) is in the ridge's shadow when the sun sits under that angle in the sun's azimuth. Plain JS: the bake
// workers compute it in row bands (src/prebake.js); node tests read it.
//
//   import { horizonMap, HORIZON } from './forest/horizon.js';
//   const h = horizonMap(terrain.heightAt, { rows: [j0, j1] });   // → Uint8Array [size × size × 8], rows j0 .. j1−1
//   // texel (i, j) covers (region.x0 + i·cell, region.z0 + j·cell); bin k is the azimuth k·45° clockwise from north
//   // (0 north −z, 2 east +x, 4 south, 6 west); the byte is the skyline's elevation angle in 90/255 ° steps.
// Eye height 8 m (a crown's middle); the march 20 m .. 4 km in geometric steps on a cached height grid (the grid
// covers the region plus a 2 km margin, so the ridges past the forest's edge still cast).
export const HORIZON = { size: 256, dirs: 8, region: { x0: -4500, x1: 5900, z0: -6000, z1: 5700 }, marginM: 2000, eyeM: 8, d0: 20, dMax: 4000, growth: 1.13 };

let gridCache = null;
function heightGrid(heightAt, H) {
  const key = heightAt;
  if (gridCache && gridCache.key === key) return gridCache;
  const { x0, x1, z0, z1 } = H.region, m = H.marginM;
  const cell = (x1 - x0) / H.size;
  const gx0 = x0 - m, gz0 = z0 - m, nx = Math.ceil((x1 - x0 + 2 * m) / cell) + 1, nz = Math.ceil((z1 - z0 + 2 * m) / cell) + 1;
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = heightAt(gx0 + i * cell, gz0 + j * cell);
  gridCache = { key, h, nx, nz, gx0, gz0, cell };
  return gridCache;
}
function sample(G, x, z) {
  const fx = Math.min(G.nx - 1.001, Math.max(0, (x - G.gx0) / G.cell)), fz = Math.min(G.nz - 1.001, Math.max(0, (z - G.gz0) / G.cell));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * G.nx + i;
  return (G.h[k] * (1 - u) + G.h[k + 1] * u) * (1 - v) + (G.h[k + G.nx] * (1 - u) + G.h[k + G.nx + 1] * u) * v;
}

export function horizonMap(heightAt, { rules = HORIZON, rows = null } = {}) {
  const H = rules, S = H.size, D = H.dirs, G = heightGrid(heightAt, H);
  const [ja, jb] = rows ?? [0, S];
  const out = new Uint8Array((jb - ja) * S * D);
  const { x0, z0 } = H.region, cell = (H.region.x1 - x0) / S;
  const dirs = [];
  for (let k = 0; k < D; k++) { const a = k * (2 * Math.PI / D); dirs.push([Math.sin(a), -Math.cos(a)]); }   // clockwise from north
  const dists = [];
  for (let d = H.d0; d < H.dMax; d *= H.growth) dists.push(d);
  for (let j = ja; j < jb; j++) for (let i = 0; i < S; i++) {
    const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell, h0 = sample(G, x, z) + H.eyeM;
    for (let k = 0; k < D; k++) {
      const [dx, dz] = dirs[k];
      let best = 0;
      for (let n = 0; n < dists.length; n++) {
        const d = dists[n], t = (sample(G, x + dx * d, z + dz * d) - h0) / d;
        if (t > best) best = t;
      }
      out[((j - ja) * S + i) * D + k] = Math.min(255, Math.round(Math.atan(best) / (Math.PI / 2) * 255));
    }
  }
  return out;
}
