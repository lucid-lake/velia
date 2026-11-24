// The forest's rules (moved unchanged out of src/trees-scatter.js, Velia v2's Cruise, 2026-11-14): what is a tree for the
// scatter and for the cameras' solid (src/forest/crowns.js). trees-scatter.js imports and re-exports them, the same objects.
// A lidar crown is a tree only on land at least minY m above the lake and shoreGap m from the water: the treetops file also
// holds first returns over the open lake (503 of them below −2 m, up to 58 m "tall"), which are not trees. The forest and
// the cameras' solid (src/forest/crowns.js) both keep to this, so a camera never sees past a tree the page does not draw.
export const LIDAR_LAND = { minY: 1.0, shoreGap: 2 };

export const TREE_RULES = {
  cell: 12, minH: 2.5, treeline: 1002, treelineJitter: 60, thin: 110, shoreGap: 6,   // treeline: +1,002 m above the lake (2,900 m)
  density: { keep: 0.31, shoreKeep: 0.56, granite: 0.70, graniteSlopeDeg: 38 },   // past 38° the stand thins; the cover's rock (cliffs from 40°) clears it   // thresholds on the density field
  open: { nearShore: 0.35, fullM: 80 }, snags: { withinM: 120, share: 0.07, inland: 0.03, crest: 0.09 },
  young: { share: 0.25, scale: [0.35, 0.6] }, islandSlopeDeg: 55, island: { trees: 0.22, shrubs: 0.95 },   // Fannette: sparsely timbered, brush-covered granite
  crest: { ringM: 60, riseM: 4, fullM: 12, boost: 1.4 },
  logs: { share: 0.035, lenM: [7, 18], radiusM: [0.25, 0.6] },
  rocks: { slopeDeg: 20, share: 0.14, radiusM: [0.8, 4.0] },
  shrubs: { slopeDeg: 22, share: 0.55, heightM: [1.4, 3.0] },
  region: { x0: -4500, x1: 5900, z0: -6000, z1: 5700 },   // round Emerald Bay (real frame); z1: Tallac's north flank
  lidar: true,   // inside the bay box (src/forest/treetops.js) the trees stand where the lidar's crowns are, when the file is loaded
  lidarSnags: 0.05, lidarKeep: 1,   // the share of the real crowns that are dead (the lidar cannot tell); the share kept (a tier's canopy density)
};
