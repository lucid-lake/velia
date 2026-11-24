// Fannette Island's tea house (owner, 2026-11-18: "build it, desktop only"): the small roofless granite
// ruin Lora Knight had built on the island's summit in 1929-30. Real size, never enlarged. Pure (no DOM, no GPU): the numbers the
// survey found, where it stands on our terrain, and the chart's name. The mesh is render/teaHouse.js (its own chunk, loaded only
// where src/core/features.js teaHouse is on: a desktop); render/landmarks.js draws it with its own stone pipeline.
//   TEA_HOUSE                       the survey's numbers (m) and the spot (our world: x east, z south, the summit at the origin)
//   teaHouseSeat(heightAt)          → { floor, foot, groundMin, groundMax, groundMean } from the terrain under the footprint
//   TEA_HOUSE.seat                  that seat on our shipped terrain, baked (v2/tests/tea-house.test.mjs checks it against the
//                                   terrain: the mesh never waits for the island's grid to stream)
//   footprintPoints(step)           the footprint's sample points (world x, z)

const FT = 0.3048;
export const TEA_HOUSE = Object.freeze({
  // the NRHP nomination (Vikingsholm, 1996, § 7): "a stone building that is square in plan … the mortared granite walls and
  // foundation of the 16' x 16' building remain … The roof was flat … A brick-lined, stone fireplace is in the northwest corner.
  // The floor is mortared gray shale." Taken as the outside size (the wall's 0.45 m is our estimate)
  sizeM: 16 * FT,                // 4.877 m square
  wallM: 0.45,                   // wall thickness (estimate: granite rubble, the photos' depth at the openings)
  wallTopM: 2.45,                // the wall's top over the floor (estimate from the photos: the window's 1.0 m against the wall)
  crenelM: [0.45, 1.05],          // the crown's standing slabs over the wall's top (the long-lens photo: upright, rounded, 0.3–1 m tall)
  // the rubble (round 3, the long-lens photo counted): about 4–5 courses of 0.42–0.6 m, 6–8 stones a course across the 4.88 m face
  stoneM: Object.freeze({ w: [0.5, 0.9], h: [0.42, 0.6] }),
  chimneyTopM: 3.3,              // the fireplace's stack in the north-west corner, standing proud of the walls
  // the openings (the photos: square-headed, timber lintels; the door "solid", gone with the windows): the face, the centre
  // along it (m from the face's middle, toward east on the north and south faces, toward south on the east and west), the width,
  // the sill and the head over the floor
  openings: Object.freeze([
    Object.freeze({ face: 'N', at: -1.05, w: 0.7, sill: 0.95, head: 1.95 }),
    Object.freeze({ face: 'N', at: 0.95, w: 0.7, sill: 0.95, head: 1.95 }),
    Object.freeze({ face: 'E', at: -0.3, w: 0.8, sill: 0.9, head: 1.95 }),
    Object.freeze({ face: 'S', at: 0.7, w: 0.9, sill: 0, head: 1.95 }),     // the door, toward the rock steps
    Object.freeze({ face: 'W', at: 0.45, w: 0.7, sill: 0.95, head: 1.95 }),
  ]),
  // the spot: Fannette Island's summit, our terrain's highest point (the 2022 lidar: 27.9 m here, its highest return 28.6 m; the
  // lake profile's landmarks.ruin, 2 m east of the origin), under the walls. The island's centre in the public record is
  // 38.9540745, -120.1004631 (Wikipedia), our origin 38.954159, -120.100464. The walls square to north (the nomination's
  // "northwest corner")
  x: 2, z: 0, yaw: 0,
  // the seat on our terrain (teaHouseSeat on the shipped grid; the test re-checks it): the floor over the knob's top, the
  // foundation down below its lowest point
  seat: Object.freeze({ floor: 27.97, foot: 25.63 }),
  chartName: 'Fannette Island · tea house',
});

// the footprint's points (world x, z) every `step` m, edges included
export function footprintPoints(step = 0.25, T = TEA_HOUSE) {
  const h = T.sizeM / 2, n = Math.max(1, Math.round(T.sizeM / step)), out = [];
  const c = Math.cos(T.yaw), s = Math.sin(T.yaw);
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const u = -h + (i / n) * T.sizeM, v = -h + (j / n) * T.sizeM;
    out.push([T.x + u * c - v * s, T.z + u * s + v * c]);
  }
  return out;
}

// the seat: the floor 2 cm over the knob's highest ground under the footprint (the summit is a point: nothing of it pokes
// through the shale), the foundation 0.3 m under its lowest point (no wall stands on air)
export function teaHouseSeat(heightAt, T = TEA_HOUSE) {
  const hs = footprintPoints(0.25, T).map(([x, z]) => heightAt(x, z)).sort((a, b) => a - b);
  const q = (f) => hs[Math.min(hs.length - 1, Math.floor(f * hs.length))];
  const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
  return { floor: +(hs.at(-1) + 0.02).toFixed(2), q75: q(0.75), foot: +(hs[0] - 0.3).toFixed(2), groundMin: hs[0], groundMax: hs.at(-1), groundMean: mean };
}

// the walls' top over the ground (m, world) at (x, z) inside the footprint (grown by margin m), else −Infinity: the binoculars'
// rangefinder reads the ruin as it reads the terrain (v2/ui/captain.js, a desktop only; its march steps 3 % of the range, about
// 8 m at 270 m, so it takes a 5 m margin: the reading within a few metres, never stepping over the walls)
export const RANGE_MARGIN_M = 5;
export function teaHouseTop(x, z, margin = 0, T = TEA_HOUSE) {
  const dx = x - T.x, dz = z - T.z, c = Math.cos(T.yaw), s = Math.sin(T.yaw), h = T.sizeM / 2 + margin;
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  return Math.abs(u) <= h && Math.abs(v) <= h ? T.seat.floor + T.wallTopM : -Infinity;
}
