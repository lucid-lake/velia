// Lakeshore terrain LOD, the plain-JS part (no three.js): the quadtree's leaves for a camera and a chunk's height
// samples. src/terrain-mesh.js builds the meshes from them; src/prebake.js bakes the heights in workers at load.
//   lodLeaves({ x, y, z })                → [[x0, z0, size], …] the chunks to draw
//   chunkHeights(heightAt, x0, z0, size)  → Float32Array (CELLS + 3)², the grid plus a one-sample border, rows by z
// The root covers the far Sierra ring (81.92 km, centred on the island): the far shore, the crest and the peaks round
// the lake are real terrain to the horizon, in big coarse chunks (a 20 km chunk has 320 m cells), so there is no
// curtain to close the view. Leaves are 160 m (2.5 m cells, the bay's 2 m data); over Fannette Island (FINE box) they
// go down to 40 m (0.625 m cells) so the 1 m lidar knob keeps its ledges.
// ROOT and FINE are the lake profile's (src/waters/<id>.json terrain.root, terrain.fine): this page's lake.
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
export const ROOT = CURRENT_WATERS.terrain.root, LEAF = 160, CELLS = 64, SPLIT = 1.6;
// the split distance factor: High's (SPLIT); a TerrainLOD holds its tier's own (src/terrain-mesh.js split, setSplit)
export const LOD = Object.freeze({ split: SPLIT });
// (the water's map centres moved to the lake profile: terrain.bayCentre, terrain.lakeCentre; makeTerrain().lake.bay)
export const FINE = CURRENT_WATERS.terrain.fine;

// does the node split for this camera? (within SPLIT × its size, and larger than the leaf; 40 m over the island)
// focus (the binoculars, 2026-10-29): a second, virtual eye ({ x, y, z }: where the glasses' view would stand at 1×,
// on their aim); the node splits for whichever eye is nearer, so the land the glasses look at gets the detail its
// on-screen size needs and nothing else does
const nodeDist = (c, x0, z0, size) => {
  const dx = Math.max(x0 - c.x, 0, c.x - (x0 + size)), dz = Math.max(z0 - c.z, 0, c.z - (z0 + size));
  return Math.hypot(dx, dz, Math.max(0, c.y - 200));
};
export function lodSplits(cam, x0, z0, size, focus = null, split = LOD.split) {
  const d = focus ? Math.min(nodeDist(cam, x0, z0, size), nodeDist(focus, x0, z0, size)) : nodeDist(cam, x0, z0, size);
  const fine = x0 < FINE.x1 && x0 + size > FINE.x0 && z0 < FINE.z1 && z0 + size > FINE.z0;
  return (size > LEAF || (fine && size > FINE.leaf)) && d < split * size;
}
// the leaves for a camera position: split while the camera is within SPLIT × the node size
export function lodLeaves(cam, focus = null, split = LOD.split) {
  const out = [];
  const visit = (x0, z0, size) => {
    if (lodSplits(cam, x0, z0, size, focus, split)) {
      const h = size / 2;
      visit(x0, z0, h); visit(x0 + h, z0, h); visit(x0, z0 + h, h); visit(x0 + h, z0 + h, h);
    } else out.push([x0, z0, size]);
  };
  visit(-ROOT / 2, -ROOT / 2, ROOT);
  return out;
}

export function chunkHeights(heightAt, x0, z0, size) {
  const n = CELLS, step = size / n, B = n + 3;
  const hs = new Float32Array(B * B);
  for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) hs[j * B + i] = heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
  return hs;
}
