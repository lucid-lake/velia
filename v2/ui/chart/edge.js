// A point past a chart's paper (a birthplace in a region the drawn chart does not cover yet: South Lake's Off Ski Run, east of the
// bay's chart) is set at the paper's edge, on the line from the paper's centre toward it, `inset` metres in, the way a paper chart
// notes a place beyond its border. Pure, no imports: the live chart (chartModel.js buildPois) and the card's mini chart
// (ui/birthplaceCard.js) read it.
//   edgePoint(x, z, box, inset) → { x, z, far: false } inside the box (less the inset), else { x, z, far: true, km, dir }
//   box: { x0, z0, x1, z1 } world metres (x east, z south); km: the true distance from the edge point; dir: 'east', 'north' …
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function edgePoint(x, z, box, inset = 250) {
  const x0 = box.x0 + inset, x1 = box.x1 - inset, z0 = box.z0 + inset, z1 = box.z1 - inset;
  if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return { x, z, far: false };
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, dx = x - cx, dz = z - cz;
  const t = Math.min(dx ? (dx > 0 ? x1 - cx : x0 - cx) / dx : Infinity, dz ? (dz > 0 ? z1 - cz : z0 - cz) / dz : Infinity);
  const ex = cx + dx * t, ez = cz + dz * t;
  const brg = ((Math.atan2(x - ex, -(z - ez)) * 180) / Math.PI + 360) % 360;
  return { x: ex, z: ez, far: true, km: Math.round(Math.hypot(x - ex, z - ez) / 1000), dir: DIRS[Math.round(brg / 45) % 8] };
}
// the far pin's words: its name with the chart's continuation mark, and the line under it
export const farName = (name) => `${name} ›`;
export const farLine = (why, e) => `${why ? `${why} ` : ''}${e.km} km ${e.dir}, past the chart's edge.`;
