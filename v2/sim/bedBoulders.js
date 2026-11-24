// The bed's 3D boulders (feat/v2-boulders-3d; P1): the painted big-boulder bed's stones (render/bed.js BIG) raised
// as real rounded granite where the eye is near, on a desktop and a tablet at L0-L1 (src/core/features.js bedBoulders 'full').
// Plain JS: the numbers the scatter, the cull and the draw share (render/rocks.js), the clearance rule that keeps every boat's
// keel and hull off them, and the zones kept clear (moorings, anchored boats, starts). Each stone sits exactly where its painted
// twin is (the same cell, hash and jitter: render/bed.js BED_CELL_WGSL), so far away the 3D stone sinks into the bed and the
// painted one is all that is left: no pop.
// The big-boulder bed (owner, 2026-11-18: desktop only, src/core/features.js bedBoulders): two jittered layers of
// rounded boulders 1.4-5.2 m across, packed (about half the bed covered where the shore is rocky, as the kayak photos),
// thinning on the gentle sand flats (the bay's head), full to 9 m of water and gone by 14 m; seen as far as a pixel resolves a
// 3 m stone (BIG_BLUR, the sand's small detail still ends at NEAR_BLUR), and their mean tone carried past that, so the
// rocky shallows read as the photos' darker green band from afar. 'lite' (a phone, a tablet): v1's one layer (BED.boulders)
// in the new colours, its mean carried the same way (no new taps)
export const BIG = Object.freeze({
  layers: [
    { cell: 7.5, rMin: 2.2, rMax: 3.0, flat: 0.8, density: 1.0, salt: 3.7 },     // round 2: the radii toward the cell's limit (packed)
    { cell: 5.0, rMin: 1.3, rMax: 2.0, flat: 0.8, density: 1.0, salt: 23.1 },
    { cell: 3.2, rMin: 0.8, rMax: 1.28, flat: 0.8, density: 1.0, salt: 41.3 },   // round 2 (owner: "pack them much more densely"): the many 1-2.5 m stones
    { cell: 4.1, rMin: 0.95, rMax: 1.64, flat: 0.8, density: 1.0, salt: 77.7 },  // and a fourth set on its own grid, filling the gaps
  ],
  // round 2 (owner, 2026-11-18: "pack them much more densely, touching and stacked"): packed to depthPack (the rocky shallows no
  // keel reaches), thinning to deepShare of that by depthFull, gone by depthNone (bigDepthK)
  depthPack: 4, deepShare: 0.45, depthFull: 9, depthNone: 14,
  // (owner, 2026-11-19: stones where the near-water spread was low): the bay's mouth is a glacial moraine, a
  // bar of boulders, but its bed is flat, so the slope rule read it as a sand flat (0.12 of the density) and the sill showed few
  // stones. Inside each zone (x, z, r m; the edge's share of r soft) the bed counts as rocky × k whatever its slope, for the
  // paint and the 3D stones alike (BED_CELL_WGSL bedMoraine); the clearance rule still keeps every 3D stone off a keel
  moraine: { zones: [[1400, -1300, 380]], edge: 0.35, k: 0.75 },
  rocky: [0.02, 0.12], flats: 0.12,   // round 2: a shore sloping 1 in 8 is a rocky one (round 1: 0.04-0.22)   // the bed's slope (rise over run) from the sand flats (× flats) to a rocky shore (× 1)
  lump: 0.45,                         // the rim's lumps × v1's (smooth, rounded stones, as the photos)
  blur2: 0.7,                         // m: the smaller layer's own reach (its 2-4 m stones fade out by here)
  blur3: 0.45,                        // m: the third and fourth layers' (their 1-3 m stones)
  patchy: 0.15,                       // the broad patchiness's share of the density (round 1: 0.3)
  blur: 1.1,                          // m: the footprint past which a boulder is under a few pixels (its detail fades out)
  cover: 0.78,                        // the share of a packed rocky bed the three layers cover (the far mean's weight; round 1's two: 0.50)
  coverLite: 0.14,                    // v1's one layer's share (the phone's far mean)
});

export const BED3D = Object.freeze({
  layers: BIG.layers,          // the painted bed's two layers: the same cells, radii and salts
  depth: [0.0, BIG.depthNone], // m of water at the stone's centre: 3D from the waterline to where the painted ones end
  grow: [110, 200],            // m from the eye: full size inside grow[0], sunk into the bed by grow[1] (the cull's range)
  minA: 0.25,                  // m: a stone lower than this above the bed is left to the paint
  flat: 0.8,                   // the dome's height over its radius (the painted dome's BG_FLAT)
  sinkSlope: 0.3,              // × r × the bed's slope: a stone on a slope sits deeper (never floating downhill)
  // the clearance rule (m of water over the bed at the stone → the highest its top may stand, m, the surface 0): the keel
  // (1.6 m: src/sim/boat/ground.js) and 0.5 m under it wherever a keel can float; none in the 1.2-2.1 m band a keel just
  // clears; above the surface only in the last 0.6 m of water, where she is aground long before her bow gets there
  keel: 1.6, under: 0.5, band: [1.2, 2.1], breach: [0.6, 0.5], wade: -0.4,
  // round 2 (owner, 2026-11-18: "pack them much more densely, touching and stacked"): a smaller stone on a big one's dome is
  // lifted to sit on it (stack of the time; its top still kept to the rule), the rest half-buried in it
  stack: 0.5,
  // round 2 ("in the Tahoe photos I can even see some stones out of the water"): big stones at the waterline of the steep
  // shores, in clusters (a 60 m noise) and more round Fannette Island; each cell's candidate moved down the slope onto the waterline (-0.3 m), its centre in -1.0..+0.4 m (the shore line, where she
  // is aground long before), never sunk with distance (seen to `range` from the boat: a hero detail), the far mesh past `lod`
  emerge: Object.freeze({ cell: 7, rMin: 0.5, rMax: 3.5, salt: 61.7, target: -0.3, h: [-1.0, 0.6], steep: [0.12, 0.35], density: 0.9, cluster: 90, isle: [0, 0, 170, 1.8], sink: 0.12, range: 1500, lone: 0.25, slab: 0.2,
    moraine: 0.8 }),   //: inside the mouth's moraine (render/bed.js BIG.moraine) a gentle shore seeds clusters as a steep one × this
  lod: 70,                     // m: past this the stones draw the 80-triangle mesh (320 nearer)
});

// the highest a stone's top may stand (m, the surface 0) over `dep` m of water (the WGSL twin: render/rocks.js topMax)
export function topMax(dep, K = BED3D) {
  if (dep <= K.breach[0]) return K.breach[1];
  if (dep <= K.band[0]) return K.breach[1] + (K.wade - K.breach[1]) * (dep - K.breach[0]) / (K.band[0] - K.breach[0]);
  if (dep < K.band[1]) return -dep - 2;           // no stone: its top would be under the bed
  return -(K.keel + K.under);
}
// a stone's height over its centre (m): the dome's, cut to the clearance; null when the paint keeps it (too low, or out of range)
export function stoneHeight(r, dep, steep, K = BED3D) {
  if (!(dep > K.depth[0]) || dep > K.depth[1]) return null;
  const sink = r * K.sinkSlope * Math.min(steep, 1) + 0.05;
  const a = Math.min(r * K.flat, topMax(dep, K) + dep + sink);
  return a >= K.minA ? { a, cy: -dep - sink } : null;
}

// the zones kept clear of 3D stones (x, z, r m): every mooring ball and its swing, the boats at anchor and their swing, the
// starts (the Sail start, the show's start, each birthplace) with room to bear away; the paint stays (it is not solid)
export const CLEAR_R = Object.freeze({ mooring: 18, anchored: 45, start: 70 });
export const FIXED_STARTS = Object.freeze([[1200, -1050], [825, -825]]);   // v1's Sail start; the show's start (v2/sim/fireworksSite.js)
export function clearZones({ moorings = [], anchored = [], birthplaces = [], starts = FIXED_STARTS, max = 64 } = {}) {
  const out = [];
  for (const m of moorings) out.push([m.x, m.z, CLEAR_R.mooring]);
  for (const b of anchored) if (b.at) out.push([b.at[0], b.at[1], CLEAR_R.anchored]);   // a boat on a ball: the ball's zone holds her
  for (const s of starts) out.push([s[0], s[1], CLEAR_R.start]);
  for (const b of birthplaces) if (Number.isFinite(b.x) && Number.isFinite(b.z)) out.push([b.x, b.z, CLEAR_R.start]);
  return out.slice(0, max);
}
export const inClearZone = (zones, x, z) => zones.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 < r * r);

// (owner, 2026-11-19: "Do we need to load all the stones at once? Shall we load stones based on birthplace?"):
// the bed's 3D stones are placed round the player's regions, not over the whole modelled box. regions: the busy lake's rows with a
// birthplace (v2/living/busyLake.js regionsWithBirthplaces); active(regions, x, z) → the ids live at (x, z) (busyLake.js
// activeRegions: her region and its neighbours). at(x, z) → the discs [[x, z, r + marginM], …] when the set changes (the
// renderer re-places then: render/rocks.js setRegion), else null; outside every region the last set stays (null). Pure.
export const stoneDiscs = (regions, ids, marginM = 0) => regions.filter((r) => ids.has(r.id)).map((r) => [r.centre[0], r.centre[1], r.radiusM + marginM]);
export function createStoneRegion({ regions = [], active, marginM = 0 } = {}) {
  let key = null, discs = null;
  return {
    at(x, z) {
      if (!regions.length || !active) return null;
      const ids = active(regions, x, z);
      if (!ids.size) return null;
      const k = [...ids].sort().join(',');
      if (k === key) return null;
      key = k; discs = stoneDiscs(regions, ids, marginM);
      return discs;
    },
    get discs() { return discs; },
    get key() { return key; },
  };
}
