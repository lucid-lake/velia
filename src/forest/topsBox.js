// The lidar treetops' files and box (moved unchanged out of treetops.js, Velia v2's Cruise, 2026-11-14): the cameras' solid
// (src/forest/crowns.js) reads the box without treetops.js's loaders (they reach src/terrain-data.js and node's fs), so v2 can
// build the same solid. treetops.js imports and re-exports it.
export const TOPS = { file: '/terrain/forest/treetops.tps', phoneFile: '/terrain/forest/treetops-phone.tps',   // phone: the trees only (tools/terrain/phone_tops.mjs)
  box: { x0: -2304, z0: -1792, x1: 3328, z1: 1792 }, bucket: 48 };
