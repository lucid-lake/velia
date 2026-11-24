// The camera presets (?cam=), shared by the core (src/core/index.js) and the load-time bake (src/prebake.js), which
// bakes the terrain chunks for the first lod.update() at the preset's position. Plain data: no three.js.
// World frame (src/geo.js): the real Emerald Bay, Fannette Island's summit at the origin, x east, z south (2026-10-29).
// The bay runs from its head (south-west, ≈ (−600, 250)) to its mouth (north-east, ≈ (1690, −1270)); the open lake
// lies north and east beyond the mouth.
// where the modes start, for the load-time bake's start bubble (src/prebake.js); tests/stream-scatter checks them
// against Day Sail's START and Chill's CHILL.start
export const MODE_STARTS = { sail: [1200, -1050], chill: [270, 30] };
export const CAMERAS = {
  A: { pos: [1050, 40, -820], look: [-900, 160, 520] },     // above the bay by the mouth, up the bay over the island to its head
  B: { pos: [800, 1.6, -560], look: [-900, 90, 520] },      // eye level on the water, the island ahead, the head's walls
  C: { pos: [1050, 1.6, -820], look: [-900, 160, 520] },    // test: A's pitch at B's height
  D: { pos: [800, 40, -560], look: [-900, 90, 520] },       // test: B's pitch at A's height
  E: { pos: [1050, 40, -820], look: [4200, 200, -5200] },   // test: A turned out of the mouth to the open lake (NE: the dawn side)
  F: { pos: [1050, 40, -820], look: [-1800, 250, -900] },   // test: A turned west, to the bay's north wall
  // the classic Emerald Bay overlook (the Hwy 89 vista on the bay's north-west wall, ≈ 38.9555 N 120.1106 W, the
  // ground 166 m up; the eye 20 m over it, in a clearing: terrain.keepOut): east over the island, the mouth and the open
  // lake to the left, the Carson Range beyond (Wikimedia Commons "Emerald Bay 2011", CC0, the reference)
  O: { pos: [-875, 186, -150], look: [1500, -40, 60], fov: 55 },
  // a low pass by Fannette Island: 10 m up, 125 m off its west-south-west side with the evening sun behind, looking
  // over its granite knob east-north-east down the bay
  I: { pos: [-115, 10, 55], look: [10, 12, -5], fov: 50 },
  // out through the mouth to the open lake, the far shore ≈ 30 km off and the peaks round it (a boat's eye, 3 m)
  L: { pos: [1750, 3, -1900], look: [6000, 150, -30000], fov: 50 },
  // from the open lake back at the bay's mouth, Mount Tallac and the Desolation crest behind it
  M: { pos: [3200, 6, -4600], look: [300, 600, 3500], fov: 50 },
};
