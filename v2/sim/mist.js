// The spray mist (storm round 2, 2026-11-24; the owner's pick in the web-ocean study: "spray mist per weather"): in a strong
// wind, from about 11–12 m/s (Beaufort 6, a "strong breeze": "some airborne spray"; Beaufort 8 and up, "spindrift" streaking off
// the crests), and in the storm's outflow, a fine mist streams off the crests downwind, low over the water. Plain JS, no DOM,
// no GPU: the numbers the water's pass reads (render/mist.js MIST_WGSL, folded into render/water.js's fragment: no new pass,
// no new pipeline), its drift integrated on the scene clock, and the JS twin of its per-pixel weight the tests call.
//   It reads the one wind: the local wind the water already reads (render/windWater.js windLocal: the field with the gusts and
//   the outflow), the gust as the local wind over its surroundings (denser in a gust), its drift the eye's wind under the
//   outflow (v2/sim/storm.js waterWind) integrated, so the wisps move with the air, far faster than the waves under them.
//   Cheap: past the onset only (a branch on the local wind), one tap a layer of the baked lace's coarse mips (one layer on the
//   lite water) along the wind's two nearest fixed directions (the lanes' bins: a shift never swings the far mist sideways), the footprint's mean far
//   off (no sparkle: the owner's rule), at most MIST.max of the pixel (the navy deep water stays navy between the wisps).
//   Off at L3, lighter at L2 (the quality ladder, engine/quality.js mist), off under Reduced Motion (it streams at half the
//   wind's speed), ?spraymist=0 off (the A/B), ?spraymist=1 on at any level.
//   const d = mistDrift(d, U, travelRad, dt)   mistLevel({ rung, reduced, flag })   mistWeight(U, storm, gust) (the twin)
export const MIST = Object.freeze({
  onset: [11, 16],     // m/s of the local wind (the storm's foam boost included, as the whitecaps read it): from Beaufort 6 to 7
  storm: 0.7,          // the outflow's share at its full strength, whatever the wind (the storm's sea is wind-blown spray)
  stormU: [5, 9],      // m/s: the storm's share fades in over this much local wind (a lull ahead of the line carries none)
  gust: 1.4,           // the extra density per unit of gust (the local wind over its surroundings − 1, capped at 1)
  speed: 0.5,          // the wisps' drift: this share of the wind (fine drops ride the air near the water, slowed by it)
  speed2: 0.72,        // the second layer's (desktop): the two cross and the wisps evolve, never a texture sliding
  scale: [1 / 34, 1 / 5.5],   // the wisps: 34 m along the wind, 5.5 m across a tile of the lace
  scale2: [1 / 21, 1 / 3.6],  // the second layer's
  wisp: [0.45, 0.8],   // the pattern thresholded into wisps (soft edges)
  lod: 3,              // the lace's mip level read (256 → 32 texels a tile: its cells blur into blobs)
  lace: 0.43,          // the lace's mean at that level (centres the pattern)
  laceGain: 4,         // the blurred lace's contrast, stretched back
  mean: 0.22,          // the wisps' mean, where the footprint outgrows them
  far: [0.4, 2.5],     // m a pixel: the wisps fade to their mean over this footprint
  crest: 0.55,         // the share carried by the big waves' crests (the rest is everywhere): the mist comes off the crests
  tau: 0.2,            // the optical depth at full density, straight down
  slant: 0.3,          // the slant's floor (V.y + this): low over the water, so a grazing view crosses more of it
  max: 0.25,           // at most this much of a pixel
  binDeg: 10,          // the fixed directions, this far apart (render/spume.js SPUME.binDeg)
  binFade: [0.35, 0.65],
  albedo: 0.85,        // of the light it scatters (sky + a forward lobe of the sun)
});

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the mist's per-pixel weight before its pattern and slant (the WGSL's mistK): 0 under the onset with no storm. U: the local wind
// (m/s, the storm's foam boost included); storm: the outflow's strength 0–1 (F.storm.x × F.front.w); gust: the local wind over
// its surroundings (1 steady)
export function mistWeight(U, storm = 0, gust = 1, M = MIST) {
  const k = Math.max(smooth(M.onset[0], M.onset[1], U), storm * M.storm * smooth(M.stormU[0], M.stormU[1], U));
  return k * (1 + M.gust * Math.min(1, Math.max(0, gust - 1)));
}

// the drift (m, [x, z, t]) integrated: the wisps ride speed × the wind along its travel (rad, atan2(z, x)); a step longer than
// 1 s is a jump (a cut): not integrated
export function mistDrift(d, U, travelRad, dt, M = MIST) {
  const s = Math.min(Math.max(dt, 0), 1), k = M.speed * Math.max(U, 0) * s;
  d[0] += Math.cos(travelRad) * k; d[1] += Math.sin(travelRad) * k;
  return d;
}

// the amount (the uniform's x): 0 off. rung: the quality level's row's mist (engine/quality.js LEVELS: 1, 1, 0.5, 0); reduced:
// Reduced Motion; flag: ?spraymist (0 off, 1 on whatever the level)
export function mistLevel({ rung = 1, reduced = false, flag = null } = {}) {
  if (flag === false || flag === 0 || flag === '0') return 0;
  if (flag === true || flag === 1 || flag === '1') return 1;
  if (reduced) return 0;
  return Math.max(0, Math.min(1, rung ?? 0));
}

// the drift of the wisps a pixel sees, by the wind's travel (rad): the unit vector the mist streams along (the tests' check
// that it follows the wind; the WGSL's bins straddle it)
export const mistDir = (travelRad) => [Math.cos(travelRad), Math.sin(travelRad)];
