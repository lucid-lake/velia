// The forest as a solid for camera sight lines (owner, 2026-10-30: "the island view is blocked by trees"). The terrain's
// height alone let a shore camera stand among the trunks and look through a wall of crowns. Here every lidar crown
// (src/forest/treetops.js) is a column from the ground to its top, CROWNS.padM wider than its radius, rasterised once
// onto a CROWNS.cell grid over the bay box; outside the box (the rule-scattered forest, no lidar) land more than
// TREE_RULES.shoreGap from the water counts as forest CROWNS.farTopM tall (a safe guess: those slopes are wooded).
// Plain JS, no three.js: node tests build it from the same file the page loads.
//
//   const solid = crownSolid(terrain, tops);    // tops: decodeTops(...) or getTops(); null: the fallback everywhere
//   solid.top(x, z)        // the crown top's world y at (x, z), or -Infinity where no tree stands
//   solid.at(x, z)         // max(terrain, crown top): what a sight line must clear
//   solid.open(x, z, r)    // no crown within r m: a camera may stand here (forward of the tree line, open rock)
import { TOPS } from './topsBox.js';
import { TREE_RULES, LIDAR_LAND } from './rules.js';

const CROWNS = { cell: 2, padM: 1.0, minR: 1.2, farTopM: 32 };

export function crownSolid(terrain, tops, C = CROWNS) {
  const b = TOPS.box, cell = C.cell;
  const w = Math.ceil((b.x1 - b.x0) / cell), h = Math.ceil((b.z1 - b.z0) / cell);
  const grid = tops ? new Float32Array(w * h).fill(-Infinity) : null;
  if (tops) {
    for (let i = 0; i < tops.n; i++) {
      const x = tops.x[i], z = tops.z[i], g = terrain.heightAt(x, z);
      // the forest's own rule (trees-scatter.js LIDAR_LAND): a return over the water is no tree, so it blocks no sight line
      if (g < LIDAR_LAND.minY || (terrain.shoreDistance && terrain.shoreDistance(x, z) < LIDAR_LAND.shoreGap)) continue;
      const top = g + tops.h[i], r = Math.max(C.minR, tops.r[i]) + C.padM;
      const i0 = Math.max(0, Math.floor((x - r - b.x0) / cell)), i1 = Math.min(w - 1, Math.floor((x + r - b.x0) / cell));
      const j0 = Math.max(0, Math.floor((z - r - b.z0) / cell)), j1 = Math.min(h - 1, Math.floor((z + r - b.z0) / cell));
      for (let j = j0; j <= j1; j++) {
        const cz = b.z0 + (j + 0.5) * cell - z;
        for (let k = i0; k <= i1; k++) {
          const cx = b.x0 + (k + 0.5) * cell - x;
          // the cell is touched if any of it is inside the crown: its centre within r + half a diagonal
          if (cx * cx + cz * cz > (r + cell * 0.71) ** 2) continue;
          const q = j * w + k; if (top > grid[q]) grid[q] = top;
        }
      }
    }
  }
  const inBox = (x, z) => x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1;
  const top = (x, z) => {
    if (grid && inBox(x, z)) return grid[Math.floor((z - b.z0) / cell) * w + Math.floor((x - b.x0) / cell)];
    const g = terrain.heightAt(x, z);
    if (g < TREE_RULES.minH || (terrain.shoreDistance && terrain.shoreDistance(x, z) < TREE_RULES.shoreGap)) return -Infinity;
    return g + C.farTopM;
  };
  const at = (x, z) => Math.max(terrain.heightAt(x, z), top(x, z));
  const open = (x, z, r = 6) => {
    for (let dz = -r; dz <= r; dz += cell) for (let dx = -r; dx <= r; dx += cell) {
      if (dx * dx + dz * dz > r * r) continue;
      if (top(x + dx, z + dz) > -Infinity) return false;
    }
    return true;
  };
  return { top, at, open, lidar: !!grid, cell };
}

// A clear sight line from a to b ([x, y, z]) over the solid (terrain and crowns), sampled every `step` m, `slack` m of air.
export function sightClear(solidAt, a, b, { step = 2, slack = 0.5 } = {}) {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(2, Math.ceil(L / step));
  for (let i = 1; i < n; i++) {
    const f = i / n;
    if (solidAt(a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f) + slack > a[1] + (b[1] - a[1]) * f) return false;
  }
  return true;
}
