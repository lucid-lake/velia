// The stage's named areas ("areas are rows in v2/stage/areas.js (centre, radius, lake), so the
// whole-lake map adds rows, not code"). Pure data and two small reads; no DOM, no GPU.
//   AREAS                    the rows: { id, lake, x, z (m, x east, z south, Fannette Island's summit the origin), r (m), name }
//   areaOf(id, lake)         → the row, or null (another lake has no such area yet)
//   distToArea(a, x, z)      → m from the point to the area's edge (≤ 0 inside)
//   inArea(a, x, z, pad = 0) → the point is inside the area grown by pad m
export const AREAS = Object.freeze([
  // Tessie's water (owner 2026-11-17: "Tessie is like a boss in a certain area"): the deep water between
  // Fannette Island and the bay's north wall, 400 m across. Picked from the terrain grid (src/sim/terrain.js): 61 m at the
  // centre, the whole disc water and 98 % of it 40 m or deeper (its shallowest edge, toward the north wall, 36 m)
  Object.freeze({ id: 'tessieWaters', lake: 'tahoe-emerald', x: 300, z: -130, r: 200, name: "Tessie's water" }),
]);

export function areaOf(id, lake = 'tahoe-emerald') {
  return AREAS.find((a) => a.id === id && (!lake || a.lake === lake)) ?? null;
}
export const distToArea = (a, x, z) => Math.hypot(x - a.x, z - a.z) - a.r;
export const inArea = (a, x, z, pad = 0) => distToArea(a, x, z) <= pad;
