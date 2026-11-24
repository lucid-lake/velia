// The streaming grid: square tiles in the world frame (x east, z south, metres), with integer ids.
// Plain JS: node tests, workers and the manager share it.
//   tileOf(x, z)          → [ix, iz]      the tile holding (x, z); tile (0, 0) spans x, z ∈ [0, size)
//   tileKey(ix, iz)       → 'ix,iz'       the id (a string: Map keys, logs)
//   parseKey('ix,iz')     → [ix, iz]
//   tileRect(ix, iz)      → { x0, z0, x1, z1 }
//   rectDist(x, z, r)     → m from (x, z) to the rect (0 inside)
//   tilesWithin(x, z, R)  → [[ix, iz, d], …] every tile whose rect is within R m, nearest first
//   predictPath(p, v, leadS, step) → [{ x, z, t }]  the straight-line path ahead over the lead time
import { STREAM } from './config.js';

export function tileOf(x, z, size = STREAM.tile) { return [Math.floor(x / size), Math.floor(z / size)]; }
export const tileKey = (ix, iz) => `${ix},${iz}`;
export const parseKey = (k) => k.split(',').map(Number);
export function tileRect(ix, iz, size = STREAM.tile) { return { x0: ix * size, z0: iz * size, x1: (ix + 1) * size, z1: (iz + 1) * size }; }
export function rectDist(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}
export function tilesWithin(x, z, R, size = STREAM.tile) {
  const out = [];
  const i0 = Math.floor((x - R) / size), i1 = Math.floor((x + R) / size), j0 = Math.floor((z - R) / size), j1 = Math.floor((z + R) / size);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = rectDist(x, z, tileRect(i, j, size));
    if (d <= R) out.push([i, j, d]);
  }
  return out.sort((a, b) => a[2] - b[2]);
}
// the path ahead: the camera's ground position plus its velocity × t, sampled every `step` m (at least the start and
// the end); a camera at rest gives just its position
export function predictPath(p, v, leadS, step = STREAM.lead.pathStep) {
  const speed = Math.hypot(v.x, v.z), reach = speed * leadS;
  const n = Math.max(1, Math.ceil(reach / step));
  const out = [];
  for (let k = 0; k <= n; k++) { const t = speed > 1e-3 ? (k / n) * leadS : 0; out.push({ x: p.x + v.x * t, z: p.z + v.z * t, t }); if (speed <= 1e-3) break; }
  return out;
}
